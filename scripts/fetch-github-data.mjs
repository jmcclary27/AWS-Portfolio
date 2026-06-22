import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const contentPath = path.join(repoRoot, "site", "data", "content.json");
const outputPath = path.join(repoRoot, "site", "data", "github.json");

await loadLocalEnv(path.join(repoRoot, ".env"));

const strictMode = process.argv.includes("--strict");
const now = new Date();
const zonedPartFormatters = new Map();

const content = await readJson(contentPath);
const siteConfig = content.site ?? {};
const githubUsername =
  process.env.PORTFOLIO_GITHUB_USERNAME ||
  siteConfig.githubUsername ||
  "jmcclary27";
const timeZone = assertValidTimeZone(
  process.env.PORTFOLIO_TIME_ZONE || siteConfig.timeZone || "UTC",
);
const displayYear = Number(
  process.env.PORTFOLIO_DISPLAY_YEAR ||
    siteConfig.displayYear ||
    getZonedParts(now, timeZone).year,
);
const token = process.env.GITHUB_TOKEN || process.env.GH_PORTFOLIO_TOKEN || "";
const featuredRepoRequests = normalizeFeaturedRepos(
  content.featuredRepos ?? [],
  githubUsername,
);

try {
  let dashboardData;

  if (!token) {
    throw new Error(
      "Missing GitHub token. Set GH_PORTFOLIO_TOKEN or GITHUB_TOKEN to fetch live data.",
    );
  }

  dashboardData = await fetchDashboardData({
    token,
    githubUsername,
    displayYear,
    featuredRepoRequests,
    now,
    timeZone,
  });

  await writeJson(outputPath, dashboardData);
  console.log(
    `Wrote ${path.relative(repoRoot, outputPath)} with live GitHub data for ${githubUsername}.`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  if (strictMode) {
    throw error;
  }

  const existingData = await readJson(outputPath, null);
  const fallbackData = buildFallbackData({
    githubUsername,
    displayYear,
    featuredRepoRequests,
    now,
    timeZone,
    message,
    existingData,
  });

  await writeJson(outputPath, fallbackData);
  console.warn(
    `Fell back to placeholder GitHub data because live fetch failed: ${message}`,
  );
}

async function fetchDashboardData({
  token,
  githubUsername,
  displayYear,
  featuredRepoRequests,
  now,
  timeZone,
}) {
  const rangeStart = buildZonedDateTimeIso(
    { year: displayYear, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
  const rangeEnd = buildContributionRangeEnd(displayYear, now, timeZone);
  const featuredRepoSelection = buildFeaturedRepoSelection(featuredRepoRequests);
  const query = `
    query PortfolioDashboard($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        login
        name
        url
        avatarUrl(size: 160)
        bio
        company
        location
        websiteUrl
        followers {
          totalCount
        }
        repositories(
          first: 12
          ownerAffiliations: OWNER
          privacy: PUBLIC
          isFork: false
          orderBy: { field: STARGAZERS, direction: DESC }
        ) {
          nodes {
            ...RepoFields
          }
        }
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                contributionLevel
                color
                date
                weekday
              }
            }
          }
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
          commitContributionsByRepository(maxRepositories: 8) {
            repository {
              ...RepoContributionFields
            }
            contributions(first: 12) {
              totalCount
              nodes {
                commitCount
                occurredAt
              }
            }
          }
          issueContributionsByRepository(maxRepositories: 8) {
            repository {
              ...RepoContributionFields
            }
            contributions(first: 8) {
              totalCount
              nodes {
                occurredAt
                issue {
                  number
                  state
                  title
                  url
                }
              }
            }
          }
          pullRequestContributionsByRepository(maxRepositories: 8) {
            repository {
              ...RepoContributionFields
            }
            contributions(first: 8) {
              totalCount
              nodes {
                occurredAt
                pullRequest {
                  number
                  state
                  title
                  url
                  merged
                }
              }
            }
          }
          pullRequestReviewContributionsByRepository(maxRepositories: 8) {
            repository {
              ...RepoContributionFields
            }
            contributions(first: 8) {
              totalCount
              nodes {
                occurredAt
                pullRequest {
                  number
                  state
                  title
                  url
                  merged
                }
              }
            }
          }
        }
      }
      ${featuredRepoSelection}
    }

    fragment RepoContributionFields on Repository {
      name
      nameWithOwner
      url
      description
      isFork
      homepageUrl
      stargazerCount
      forkCount
      parent {
        nameWithOwner
        url
      }
      updatedAt
      primaryLanguage {
        name
        color
      }
    }

    fragment RepoFields on Repository {
      ...RepoContributionFields
      openGraphImageUrl
      repositoryTopics(first: 4) {
        nodes {
          topic {
            name
          }
        }
      }
      languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
        nodes {
          color
          name
        }
      }
    }
  `;

  const payload = await githubGraphql(query, { login: githubUsername, from: rangeStart, to: rangeEnd }, token);
  const user = payload?.user;

  if (!user) {
    throw new Error(`GitHub user "${githubUsername}" was not found.`);
  }

  const contributions = user.contributionsCollection;
  const weeks = normalizeWeeks(contributions.contributionCalendar?.weeks ?? []);
  const days = weeks.flatMap((week) => week.days);
  const streaks = calculateStreaks(days);
  const activeDays = days.filter((day) => day.count > 0);
  const busiestDay = activeDays.reduce(
    (topDay, currentDay) =>
      !topDay || currentDay.count > topDay.count ? currentDay : topDay,
    null,
  );
  const contributionRepoMap = aggregateContributionRepos(contributions);

  const autoFeaturedRepos = (user.repositories?.nodes ?? [])
    .filter(Boolean)
    .map((repo) => shapeRepo(repo))
    .slice(0, 6);

  const configuredFeaturedRepos = featuredRepoRequests
    .map((repoRequest, index) => {
      const repo = payload?.[`featuredRepo${index}`];
      if (!repo) {
        return null;
      }
      return shapeRepo(repo, { pinned: true, source: repoRequest });
    })
    .filter(Boolean);

  const mergedFeaturedRepos = mergeReposWithFallback(
    configuredFeaturedRepos,
    autoFeaturedRepos,
  ).slice(0, 6);

  return {
    generatedAt: now.toISOString(),
    status: "live",
    year: displayYear,
    username: githubUsername,
    profile: {
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      company: user.company,
      followers: user.followers?.totalCount ?? 0,
      location: user.location,
      login: user.login,
      name: user.name || user.login,
      url: user.url,
      websiteUrl: user.websiteUrl,
    },
    summaryStats: {
      totalContributions:
        contributions.contributionCalendar?.totalContributions ?? 0,
      commits: contributions.totalCommitContributions ?? 0,
      pullRequests: contributions.totalPullRequestContributions ?? 0,
      issues: contributions.totalIssueContributions ?? 0,
      reviews: contributions.totalPullRequestReviewContributions ?? 0,
      repositoriesContributedTo: contributionRepoMap.size,
      activeDays: activeDays.length,
      averagePerActiveDay: activeDays.length
        ? roundToOneDecimal(
            (contributions.contributionCalendar?.totalContributions ?? 0) /
              activeDays.length,
          )
        : 0,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
      busiestDay: busiestDay
        ? {
            count: busiestDay.count,
            date: busiestDay.date,
          }
        : null,
    },
    contributionCalendar: {
      totalContributions:
        contributions.contributionCalendar?.totalContributions ?? 0,
      weeks,
    },
    featuredRepos: mergedFeaturedRepos,
    topContributionRepos: Array.from(contributionRepoMap.values())
      .sort((left, right) => right.total - left.total)
      .slice(0, 6),
    languageBreakdown: buildLanguageBreakdown(contributionRepoMap, mergedFeaturedRepos),
    recentActivity: buildRecentActivity(contributions),
  };
}

function normalizeFeaturedRepos(featuredRepos, defaultOwner) {
  return featuredRepos
    .map((entry) => {
      if (typeof entry === "string") {
        if (entry.includes("/")) {
          const [owner, name] = entry.split("/");
          return { owner, name };
        }
        return { owner: defaultOwner, name: entry };
      }

      if (entry && typeof entry === "object" && entry.name) {
        return {
          owner: entry.owner || defaultOwner,
          name: entry.name,
        };
      }

      return null;
    })
    .filter(Boolean);
}

function buildFeaturedRepoSelection(featuredRepoRequests) {
  return featuredRepoRequests
    .map(
      (repo, index) => `
      featuredRepo${index}: repository(owner: "${repo.owner}", name: "${repo.name}") {
        ...RepoFields
      }`,
    )
    .join("\n");
}

async function githubGraphql(query, variables, token) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "aws-portfolio-dashboard",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed with ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((item) => item.message).join(" | "));
  }

  return payload.data;
}

function normalizeWeeks(rawWeeks) {
  return rawWeeks.map((week) => ({
    days: (week.contributionDays ?? []).map((day) => ({
      count: day.contributionCount ?? 0,
      date: day.date,
      level: normalizeContributionLevel(day.contributionLevel, day.contributionCount ?? 0),
      weekday: day.weekday ?? new Date(day.date).getUTCDay(),
    })),
  }));
}

function normalizeContributionLevel(level, count) {
  if (level) {
    return level.toLowerCase();
  }

  if (count <= 0) {
    return "none";
  }

  if (count <= 2) {
    return "first_quartile";
  }

  if (count <= 4) {
    return "second_quartile";
  }

  if (count <= 6) {
    return "third_quartile";
  }

  return "fourth_quartile";
}

function calculateStreaks(days) {
  let current = 0;
  let longest = 0;
  let rolling = 0;

  for (const day of days) {
    if (day.count > 0) {
      rolling += 1;
      longest = Math.max(longest, rolling);
    } else {
      rolling = 0;
    }
  }

  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (days[index].count > 0) {
      current += 1;
    } else {
      break;
    }
  }

  return { current, longest };
}

function aggregateContributionRepos(contributions) {
  const repoMap = new Map();

  const contributionSources = [
    ["commitContributionsByRepository", "commits"],
    ["issueContributionsByRepository", "issues"],
    ["pullRequestContributionsByRepository", "pullRequests"],
    ["pullRequestReviewContributionsByRepository", "reviews"],
  ];

  for (const [field, statKey] of contributionSources) {
    for (const repoContribution of contributions[field] ?? []) {
      const repository = repoContribution.repository;
      if (!repository?.nameWithOwner) {
        continue;
      }

      const key = repository.nameWithOwner;
      const current = repoMap.get(key) ?? {
        ...shapeRepo(repository),
        commits: 0,
        issues: 0,
        pullRequests: 0,
        reviews: 0,
        total: 0,
      };

      const contributionCount = repoContribution.contributions?.totalCount ?? 0;
      current[statKey] += contributionCount;
      current.total += contributionCount;

      repoMap.set(key, current);
    }
  }

  return repoMap;
}

function buildLanguageBreakdown(contributionRepoMap, featuredRepos) {
  const languageMap = new Map();
  const allRepos = [...contributionRepoMap.values(), ...featuredRepos];

  for (const repo of allRepos) {
    if (!repo.primaryLanguage?.name) {
      continue;
    }

    const key = repo.primaryLanguage.name;
    const current = languageMap.get(key) ?? {
      color: repo.primaryLanguage.color || "#4f46e5",
      name: key,
      value: 0,
    };

    current.value += Math.max(repo.total || 0, 1);
    languageMap.set(key, current);
  }

  return Array.from(languageMap.values())
    .sort((left, right) => right.value - left.value)
    .slice(0, 6);
}

function buildRecentActivity(contributions) {
  const activity = [];

  for (const repoContribution of contributions.commitContributionsByRepository ?? []) {
    const repository = repoContribution.repository;
    for (const item of repoContribution.contributions?.nodes ?? []) {
      if (!item?.occurredAt) {
        continue;
      }

      activity.push({
        date: item.occurredAt,
        repo: repository?.nameWithOwner ?? "Repository",
        title:
          item.commitCount === 1
            ? "Pushed 1 commit"
            : `Pushed ${item.commitCount} commits`,
        type: "commit",
        url: repository?.url ?? "#",
      });
    }
  }

  for (const repoContribution of contributions.pullRequestContributionsByRepository ?? []) {
    const repository = repoContribution.repository;
    for (const item of repoContribution.contributions?.nodes ?? []) {
      const pullRequest = item?.pullRequest;
      if (!pullRequest?.url || !item?.occurredAt) {
        continue;
      }

      activity.push({
        date: item.occurredAt,
        repo: repository?.nameWithOwner ?? "Repository",
        title: pullRequest.title,
        type: "pull_request",
        url: pullRequest.url,
      });
    }
  }

  for (const repoContribution of contributions.issueContributionsByRepository ?? []) {
    const repository = repoContribution.repository;
    for (const item of repoContribution.contributions?.nodes ?? []) {
      const issue = item?.issue;
      if (!issue?.url || !item?.occurredAt) {
        continue;
      }

      activity.push({
        date: item.occurredAt,
        repo: repository?.nameWithOwner ?? "Repository",
        title: issue.title,
        type: "issue",
        url: issue.url,
      });
    }
  }

  for (const repoContribution of contributions.pullRequestReviewContributionsByRepository ?? []) {
    const repository = repoContribution.repository;
    for (const item of repoContribution.contributions?.nodes ?? []) {
      const pullRequest = item?.pullRequest;
      if (!pullRequest?.url || !item?.occurredAt) {
        continue;
      }

      activity.push({
        date: item.occurredAt,
        repo: repository?.nameWithOwner ?? "Repository",
        title: `Reviewed: ${pullRequest.title}`,
        type: "review",
        url: pullRequest.url,
      });
    }
  }

  return activity
    .sort((left, right) => new Date(right.date) - new Date(left.date))
    .slice(0, 8);
}

function shapeRepo(repo, options = {}) {
  if (!repo) {
    return null;
  }

  return {
    description: repo.description || "Description coming soon.",
    forkCount: repo.forkCount ?? 0,
    homepageUrl: repo.homepageUrl || "",
    isFork: repo.isFork ?? false,
    isPinned: options.pinned ?? false,
    languageList: (repo.languages?.nodes ?? [])
      .filter(Boolean)
      .map((language) => ({
        color: language.color || "#4f46e5",
        name: language.name,
      })),
    name: repo.name,
    nameWithOwner: repo.nameWithOwner,
    openGraphImageUrl: repo.openGraphImageUrl || "",
    parentNameWithOwner: repo.parent?.nameWithOwner || "",
    parentUrl: repo.parent?.url || "",
    primaryLanguage: repo.primaryLanguage
      ? {
          color: repo.primaryLanguage.color || "#4f46e5",
          name: repo.primaryLanguage.name,
        }
      : null,
    stars: repo.stargazerCount ?? 0,
    topics: (repo.repositoryTopics?.nodes ?? [])
      .filter(Boolean)
      .map((entry) => entry.topic?.name)
      .filter(Boolean),
    updatedAt: repo.updatedAt,
    url: repo.url,
  };
}

function mergeReposWithFallback(primaryRepos, fallbackRepos) {
  const seen = new Set();
  const merged = [];

  for (const repo of [...primaryRepos, ...fallbackRepos]) {
    if (!repo?.nameWithOwner || seen.has(repo.nameWithOwner)) {
      continue;
    }

    seen.add(repo.nameWithOwner);
    merged.push(repo);
  }

  return merged;
}

function buildFallbackData({
  githubUsername,
  displayYear,
  featuredRepoRequests,
  now,
  timeZone,
  message,
  existingData,
}) {
  const rangeEndDate = buildContributionRangeEndDate(displayYear, now, timeZone);

  return {
    generatedAt: now.toISOString(),
    status: existingData?.status === "live" ? "stale" : "placeholder",
    year: displayYear,
    username: githubUsername,
    error: message,
    profile: existingData?.profile ?? {
      avatarUrl: "",
      bio: "",
      company: "",
      followers: 0,
      location: "",
      login: githubUsername,
      name: githubUsername,
      url: `https://github.com/${githubUsername}`,
      websiteUrl: "",
    },
    summaryStats: existingData?.summaryStats ?? {
      totalContributions: 0,
      commits: 0,
      pullRequests: 0,
      issues: 0,
      reviews: 0,
      repositoriesContributedTo: 0,
      activeDays: 0,
      averagePerActiveDay: 0,
      currentStreak: 0,
      longestStreak: 0,
      busiestDay: null,
    },
    contributionCalendar:
      existingData?.contributionCalendar ??
      buildEmptyContributionCalendar(displayYear, rangeEndDate),
    featuredRepos:
      existingData?.featuredRepos ??
      featuredRepoRequests.map((repo) => ({
        description: "Add a GitHub token to hydrate this project card with live repository metadata.",
        forkCount: 0,
        homepageUrl: "",
        isFork: false,
        isPinned: true,
        languageList: [],
        name: repo.name,
        nameWithOwner: `${repo.owner}/${repo.name}`,
        openGraphImageUrl: "",
        parentNameWithOwner: "",
        parentUrl: "",
        primaryLanguage: null,
        stars: 0,
        topics: [],
        updatedAt: now.toISOString(),
        url: `https://github.com/${repo.owner}/${repo.name}`,
      })),
    topContributionRepos: existingData?.topContributionRepos ?? [],
    languageBreakdown: existingData?.languageBreakdown ?? [],
    recentActivity: existingData?.recentActivity ?? [],
  };
}

function buildEmptyContributionCalendar(year, rangeEndDate) {
  const start = parseCalendarDate(`${year}-01-01`);
  const startDay = start.getUTCDay();
  const calendarStart = new Date(start);
  calendarStart.setUTCDate(calendarStart.getUTCDate() - startDay);

  const end = parseCalendarDate(rangeEndDate);
  const endDay = end.getUTCDay();
  const calendarEnd = new Date(end);
  calendarEnd.setUTCDate(calendarEnd.getUTCDate() + (6 - endDay));

  const days = [];
  for (
    let cursor = new Date(calendarStart);
    cursor <= calendarEnd;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const date = new Date(cursor);
    const inRange = date >= start && date <= end;
    days.push({
      count: 0,
      date: date.toISOString().slice(0, 10),
      level: "none",
      weekday: date.getUTCDay(),
      inRange,
    });
  }

  const weeks = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push({ days: days.slice(index, index + 7) });
  }

  return {
    totalContributions: 0,
    weeks,
  };
}

async function readJson(filePath, fallback = undefined) {
  try {
    const contents = await readFile(filePath, "utf8");
    return JSON.parse(contents);
  } catch (error) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadLocalEnv(filePath) {
  try {
    const contents = await readFile(filePath, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (!key || process.env[key]) {
        continue;
      }

      process.env[key] = stripEnvQuotes(value);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function assertValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch (error) {
    throw new Error(`Invalid portfolio time zone "${timeZone}".`);
  }
}

function buildContributionRangeEnd(displayYear, now, timeZone) {
  return displayYear === getZonedParts(now, timeZone).year
    ? formatDateInTimeZoneIso(now, timeZone)
    : buildZonedDateTimeIso(
        { year: displayYear, month: 12, day: 31, hour: 23, minute: 59, second: 59 },
        timeZone,
      );
}

function buildContributionRangeEndDate(displayYear, now, timeZone) {
  return displayYear === getZonedParts(now, timeZone).year
    ? formatCalendarDate(getZonedParts(now, timeZone))
    : `${displayYear}-12-31`;
}

function formatDateInTimeZoneIso(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  const offsetMinutes =
    (Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) -
      date.getTime()) /
    60000;

  return `${formatCalendarDate(parts)}T${padTime(parts.hour)}:${padTime(parts.minute)}:${padTime(parts.second)}${formatOffset(offsetMinutes)}`;
}

function buildZonedDateTimeIso(parts, timeZone) {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = parts;
  const referenceDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const zonedReferenceParts = getZonedParts(referenceDate, timeZone);
  const offsetMinutes =
    (Date.UTC(
      zonedReferenceParts.year,
      zonedReferenceParts.month - 1,
      zonedReferenceParts.day,
      zonedReferenceParts.hour,
      zonedReferenceParts.minute,
      zonedReferenceParts.second,
    ) -
      referenceDate.getTime()) /
    60000;

  return `${formatCalendarDate({ year, month, day })}T${padTime(hour)}:${padTime(minute)}:${padTime(second)}${formatOffset(offsetMinutes)}`;
}

function getZonedParts(date, timeZone) {
  let formatter = zonedPartFormatters.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zonedPartFormatters.set(timeZone, formatter);
  }

  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function parseCalendarDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function formatCalendarDate({ year, month, day }) {
  return `${year}-${padTime(month)}-${padTime(day)}`;
}

function formatOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(Math.round(offsetMinutes));
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  return `${sign}${padTime(hours)}:${padTime(minutes)}`;
}

function padTime(value) {
  return String(value).padStart(2, "0");
}
