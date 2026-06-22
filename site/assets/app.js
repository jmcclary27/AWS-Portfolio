const app = document.getElementById("app");
const loadingTemplate = document.getElementById("loading-state");

renderLoading();

boot().catch((error) => {
  console.error(error);
  app.innerHTML = `
    <section class="panel section-shell">
      <div class="section-heading">
        <p class="eyebrow">Something went wrong</p>
        <h2>Portfolio data could not be loaded.</h2>
        <p>${escapeHtml(error.message || "Unknown error.")}</p>
      </div>
    </section>
  `;
});

async function boot() {
  const [content, github] = await Promise.all([
    fetchJson("data/content.json"),
    fetchJson("data/github.json"),
  ]);

  applyHead(content);
  applyBrand(content);
  renderPortfolio(content, github);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Request for ${url} failed with ${response.status}.`);
  }
  return response.json();
}

function applyHead(content) {
  document.title = `${content.site.name} | ${content.site.role}`;
  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.content = content.site.description;
  }
}

function applyBrand(content) {
  document.getElementById("brand-eyebrow").textContent = content.hero.eyebrow;
  document.getElementById("brand-name").textContent = content.site.name;
}

function renderPortfolio(content, github) {
  const heroBadges = [
    {
      label: "Role",
      value: content.site.role,
    },
    {
      label: "Focus",
      value: content.hero.focus,
    },
    {
      label: "Based In",
      value: content.hero.location,
    },
  ];

  const timeZone = content.site.timeZone || "UTC";
  const githubStatusMessage = buildGithubStatusMessage(github);

  app.innerHTML = `
    <section class="panel hero" id="hero">
      <div class="hero-copy">
        <p class="eyebrow">${escapeHtml(content.hero.eyebrow)}</p>
        <h1>${escapeHtml(content.hero.headline)}</h1>
        <p>${escapeHtml(content.hero.summary)}</p>
        <div class="button-row">
          <a class="button button-primary" href="${escapeHtml(content.hero.primaryCta.url)}">${escapeHtml(content.hero.primaryCta.label)}</a>
          <a class="button button-secondary" href="${escapeHtml(content.hero.secondaryCta.url)}">${escapeHtml(content.hero.secondaryCta.label)}</a>
        </div>
        <div class="hero-badges">
          ${heroBadges
            .map(
              (badge) => `
                <div class="badge">
                  <span class="label">${escapeHtml(badge.label)}</span>
                  <strong>${escapeHtml(badge.value)}</strong>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
      <aside class="hero-card hero-fit-card">
        <div class="hero-fit-copy">
          <div class="hero-fit-intro">
            <p class="eyebrow">Why this portfolio exists</p>
            <h2>${escapeHtml(content.hero.asideTitle)}</h2>
            <p>${escapeHtml(content.hero.asideSummary)}</p>
          </div>
          <div class="mini-stat-row">
            <div class="mini-stat">
              <span class="mini-label">${escapeHtml(String(github.year))} Contributions</span>
              <strong>${formatNumber(github.summaryStats.totalContributions)}</strong>
            </div>
            <div class="mini-stat">
              <span class="mini-label">Featured Repos</span>
              <strong>${formatNumber(github.featuredRepos.length)}</strong>
            </div>
          </div>
        </div>
        <div class="hero-heatmap-panel">
          <div class="heatmap-header">
            <div>
              <span class="mini-label">${escapeHtml(String(github.year))} contribution map</span>
              <h3>${formatNumber(github.contributionCalendar.totalContributions)} tracked contributions</h3>
            </div>
            <p class="heatmap-subtitle">${escapeHtml(content.github.heatmapHelper)}</p>
          </div>
          ${renderHeatmap(github.contributionCalendar.weeks)}
        </div>
      </aside>
    </section>

    <section class="panel section-shell" id="projects">
      <div class="section-heading">
        <p class="eyebrow">${escapeHtml(content.projects.eyebrow)}</p>
        <h2>${escapeHtml(content.projects.title)}</h2>
        <p>${escapeHtml(content.projects.intro)}</p>
      </div>
      <div class="project-grid">
        ${renderFeaturedProjects(github.featuredRepos, content.projects.emptyState)}
      </div>
    </section>

    <section class="panel section-shell" id="resume">
      <div class="section-heading">
        <p class="eyebrow">${escapeHtml(content.resume.eyebrow)}</p>
        <h2>${escapeHtml(content.resume.title)}</h2>
        <p>${escapeHtml(content.resume.intro)}</p>
      </div>
      <div class="resume-grid">
        <article class="resume-card">
          <span class="mini-label">Snapshot</span>
          <h2>${escapeHtml(content.resume.cardTitle)}</h2>
          <p>${escapeHtml(content.resume.summary)}</p>
          <div class="button-row">
            <a class="button button-primary" href="${escapeHtml(content.resume.url)}" target="_blank" rel="noopener">${escapeHtml(content.resume.primaryAction)}</a>
            <a class="button button-secondary" href="#contact">${escapeHtml(content.resume.secondaryAction)}</a>
          </div>
        </article>
        <article class="resume-card">
          <span class="mini-label">Current priorities</span>
          <h2>${escapeHtml(content.resume.detailTitle)}</h2>
          <p>${escapeHtml(content.resume.detailSummary)}</p>
          <p class="footer-note">${escapeHtml(content.resume.footnote)}</p>
        </article>
      </div>
    </section>

    <section class="panel github-section" id="github" aria-labelledby="github-heading">
      <div class="github-header">
        <div>
          <p class="eyebrow">${escapeHtml(content.github.eyebrow)}</p>
          <h2 id="github-heading">${escapeHtml(content.github.title)}</h2>
          <p>${escapeHtml(content.github.intro)}</p>
        </div>
        <div class="github-pill">Updated ${escapeHtml(formatDateTime(github.generatedAt, timeZone))}</div>
      </div>
      ${githubStatusMessage ? `<div class="status-banner">${escapeHtml(githubStatusMessage)}</div>` : ""}
      <div class="stats-grid">
        ${renderStats(github.summaryStats)}
      </div>
      <div class="dashboard-callout dashboard-callout-wide">
        <div>
          <span class="mini-label">Momentum</span>
          <h3>${formatNumber(github.summaryStats.longestStreak)} day longest streak</h3>
          <p>${escapeHtml(content.github.callout)}</p>
        </div>
        <div class="callout-list">
          <div class="callout-item">
            <span class="mini-label">Current streak</span>
            <strong>${formatNumber(github.summaryStats.currentStreak)} days</strong>
          </div>
          <div class="callout-item">
            <span class="mini-label">Average active day</span>
            <strong>${formatDecimal(github.summaryStats.averagePerActiveDay)} contributions</strong>
          </div>
          <div class="callout-item">
            <span class="mini-label">Repositories touched</span>
            <strong>${formatNumber(github.summaryStats.repositoriesContributedTo)}</strong>
          </div>
        </div>
        <div class="repo-ranking">
          <span class="mini-label">Most active repos</span>
          ${renderContributionRankings(github.topContributionRepos)}
        </div>
      </div>
      <div class="repo-grid">
        ${renderContributionRepos(github.topContributionRepos, content.github.topRepoEmptyState)}
      </div>
      <div class="activity-grid">
        ${renderRecentActivity(github.recentActivity, content.github.activityEmptyState)}
      </div>
      <div class="copy-grid">
        <article class="copy-card">
          <span class="mini-label">Language mix</span>
          <h3>${escapeHtml(content.github.languageTitle)}</h3>
          <div class="chip-row">
            ${renderLanguages(github.languageBreakdown)}
          </div>
        </article>
        <article class="copy-card">
          <span class="mini-label">What this shows</span>
          <h3>${escapeHtml(content.github.readingTitle)}</h3>
          <p>${escapeHtml(content.github.readingSummary)}</p>
        </article>
      </div>
    </section>

    <section class="panel section-shell" id="about">
      <div class="section-heading">
        <p class="eyebrow">${escapeHtml(content.about.eyebrow)}</p>
        <h2>${escapeHtml(content.about.title)}</h2>
        <p>${escapeHtml(content.about.intro)}</p>
      </div>
      <div class="copy-grid">
        ${content.about.paragraphs
          .map(
            (paragraph) => `
              <article class="copy-card">
                <p>${escapeHtml(paragraph)}</p>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>

    <section class="panel section-shell" id="skills">
      <div class="section-heading">
        <p class="eyebrow">${escapeHtml(content.skills.eyebrow)}</p>
        <h2>${escapeHtml(content.skills.title)}</h2>
        <p>${escapeHtml(content.skills.intro)}</p>
      </div>
      <div class="skill-grid">
        ${content.skills.items
          .map(
            (item) => `
              <article class="skill-card">
                <span class="mini-label">${escapeHtml(item.kicker)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.description)}</p>
                <div class="chip-row">
                  ${item.tags
                    .map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`)
                    .join("")}
                </div>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>

    <section class="panel section-shell" id="leadership">
      <div class="section-heading">
        <p class="eyebrow">${escapeHtml(content.leadership.eyebrow)}</p>
        <h2>${escapeHtml(content.leadership.title)}</h2>
        <p>${escapeHtml(content.leadership.intro)}</p>
      </div>
      <div class="leadership-grid">
        ${content.leadership.highlights
          .map(
            (item) => `
              <article class="leadership-card">
                <span class="mini-label">${escapeHtml(item.kicker)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.description)}</p>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>

    <section class="panel section-shell" id="contact">
      <div class="section-heading">
        <p class="eyebrow">${escapeHtml(content.contact.eyebrow)}</p>
        <h2>${escapeHtml(content.contact.title)}</h2>
        <p>${escapeHtml(content.contact.intro)}</p>
      </div>
      <div class="contact-links">
        ${content.contact.links
          .map(
            (link) => `
              <article class="contact-card">
                <span class="mini-label">${escapeHtml(link.kicker)}</span>
                <strong>${escapeHtml(link.label)}</strong>
                <p>${escapeHtml(link.description)}</p>
                <a href="${escapeHtml(link.url)}" ${link.external ? 'target="_blank" rel="noopener"' : ""}>${escapeHtml(link.cta)}</a>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderFeaturedProjects(repos, emptyState) {
  if (!repos.length) {
    return `
      <article class="project-card">
        <h3>Projects are loading</h3>
        <p>${escapeHtml(emptyState)}</p>
      </article>
    `;
  }

  return repos
    .map(
      (repo) => `
        <article class="project-card">
          <span class="mini-label">${repo.isPinned ? "Featured repository" : "Repository"}</span>
          <h3>${escapeHtml(repo.name)}</h3>
          <p>${escapeHtml(repo.description)}</p>
          <div class="chip-row">
            ${renderRepoTags(repo)}
          </div>
          <footer>
            <div class="project-meta">
              <span>${formatNumber(repo.stars)} stars</span>
              <span>${formatNumber(repo.forkCount)} forks</span>
              ${
                repo.isFork && repo.parentNameWithOwner
                  ? `<span>Forked from ${escapeHtml(repo.parentNameWithOwner)}</span>`
                  : ""
              }
              <span>${escapeHtml(formatDate(repo.updatedAt))}</span>
            </div>
            <a href="${escapeHtml(repo.url)}" target="_blank" rel="noopener">View repository</a>
          </footer>
        </article>
      `,
    )
    .join("");
}

function renderStats(summaryStats) {
  const cards = [
    {
      label: "Commits",
      value: summaryStats.commits,
      helper: "Public commit contributions",
    },
    {
      label: "Pull requests",
      value: summaryStats.pullRequests,
      helper: "Opened across public repositories",
    },
    {
      label: "Issues",
      value: summaryStats.issues,
      helper: "Opened or triaged this year",
    },
    {
      label: "Reviews",
      value: summaryStats.reviews,
      helper: "PR reviews completed",
    },
  ];

  return cards
    .map(
      (card) => `
        <article class="stat-card">
          <span class="stat-label">${escapeHtml(card.label)}</span>
          <strong class="stat-value">${formatNumber(card.value)}</strong>
          <span class="stat-helper">${escapeHtml(card.helper)}</span>
        </article>
      `,
    )
    .join("");
}

function renderHeatmap(weeks) {
  if (!weeks.length) {
    return `<p>No contribution data available yet.</p>`;
  }

  const monthLabels = buildMonthLabels(weeks);
  const monthRow = monthLabels
    .map(
      (label) => `
        <span style="--month-column:${label.column};">${escapeHtml(label.label)}</span>
      `,
    )
    .join("");

  const weekColumns = weeks
    .map(
      (week) => `
        <div class="heatmap-week">
          ${week.days
            .map((day) => {
              const tooltip = `${formatDate(day.date)}: ${day.count} contribution${day.count === 1 ? "" : "s"}`;
              const outsideRange = day.inRange === false ? "true" : "false";
              const tooltipPosition = day.weekday === 0 ? "below" : "above";
              return `
                <button
                  type="button"
                  class="heatmap-day"
                  data-level="${escapeHtml(day.level)}"
                  data-outside-range="${outsideRange}"
                  data-tooltip-position="${tooltipPosition}"
                  data-tooltip="${escapeHtml(tooltip)}"
                  aria-label="${escapeHtml(tooltip)}"
                ></button>
              `;
            })
            .join("")}
        </div>
      `,
    )
    .join("");

  return `
    <div class="heatmap-scroll">
      <div class="heatmap-board" style="--week-count:${weeks.length};">
        <div class="weekday-labels" aria-hidden="true">
          <span>Sun</span>
          <span>Mon</span>
          <span>Tue</span>
          <span>Wed</span>
          <span>Thu</span>
          <span>Fri</span>
          <span>Sat</span>
        </div>
        <div>
          <div class="month-row">${monthRow}</div>
          <div class="heatmap-columns">
            ${weekColumns}
          </div>
        </div>
      </div>
    </div>
    <div class="heatmap-legend" aria-hidden="true">
      <span>Less</span>
      <span data-swatch="0"></span>
      <span data-swatch="1"></span>
      <span data-swatch="2"></span>
      <span data-swatch="3"></span>
      <span data-swatch="4"></span>
      <span>More</span>
    </div>
  `;
}

function renderContributionRankings(repos) {
  if (!repos.length) {
    return `<p>No ranked repositories yet.</p>`;
  }

  const maxTotal = Math.max(...repos.map((repo) => repo.total), 1);

  return repos
    .slice(0, 4)
    .map(
      (repo) => `
        <div class="repo-rank">
          <header>
            <strong>${escapeHtml(repo.nameWithOwner)}</strong>
            <span>${formatNumber(repo.total)}</span>
          </header>
          <div class="repo-bar">
            <span style="width:${Math.max((repo.total / maxTotal) * 100, 8)}%"></span>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderContributionRepos(repos, emptyState) {
  if (!repos.length) {
    return `
      <article class="repo-card">
        <h3>Contribution breakdown unavailable</h3>
        <p>${escapeHtml(emptyState)}</p>
      </article>
    `;
  }

  return repos
    .map(
      (repo) => `
        <article class="repo-card">
          <span class="mini-label">Contribution hotspot</span>
          <h3>${escapeHtml(repo.nameWithOwner)}</h3>
          <p>${escapeHtml(repo.description || "GitHub repository contributions for this year.")}</p>
          <div class="repo-meta">
            <span>${formatNumber(repo.commits)} commits</span>
            <span>${formatNumber(repo.pullRequests)} PRs</span>
            <span>${formatNumber(repo.issues)} issues</span>
            <span>${formatNumber(repo.reviews)} reviews</span>
          </div>
          <footer>
            <div class="chip-row">
              ${
                repo.primaryLanguage?.name
                  ? `<span class="chip">${escapeHtml(repo.primaryLanguage.name)}</span>`
                  : ""
              }
            </div>
            <a href="${escapeHtml(repo.url)}" target="_blank" rel="noopener">Open repo</a>
          </footer>
        </article>
      `,
    )
    .join("");
}

function renderRecentActivity(activity, emptyState) {
  if (!activity.length) {
    return `
      <article class="activity-card">
        <h3>Recent activity will appear here</h3>
        <p>${escapeHtml(emptyState)}</p>
      </article>
    `;
  }

  return activity
    .map(
      (item) => `
        <article class="activity-card">
          <span class="mini-label">${escapeHtml(item.type.replace("_", " "))}</span>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.repo)}</p>
          <footer>
            <div class="activity-meta">
              <span>${escapeHtml(formatDate(item.date))}</span>
            </div>
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">View on GitHub</a>
          </footer>
        </article>
      `,
    )
    .join("");
}

function renderLanguages(languages) {
  if (!languages.length) {
    return `<p>No language data available yet.</p>`;
  }

  return languages
    .map(
      (language) => `
        <span class="chip" style="color:${escapeHtml(language.color || "#4f46e5")}">
          ${escapeHtml(language.name)} (${formatNumber(language.value)})
        </span>
      `,
    )
    .join("");
}

function renderRepoTags(repo) {
  const tags = [];
  if (repo.primaryLanguage?.name) {
    tags.push(repo.primaryLanguage.name);
  }
  for (const topic of repo.topics || []) {
    tags.push(topic);
  }
  for (const language of repo.languageList || []) {
    if (!tags.includes(language.name)) {
      tags.push(language.name);
    }
  }

  return tags
    .slice(0, 4)
    .map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`)
    .join("");
}

function buildMonthLabels(weeks) {
  const labels = [];
  let previousMonth = null;

  weeks.forEach((week, index) => {
    const firstVisibleDay = week.days.find((day) => day.inRange !== false) || week.days[0];
    if (!firstVisibleDay?.date) {
      return;
    }

    const month = new Date(`${firstVisibleDay.date}T00:00:00Z`).toLocaleString("en-US", {
      month: "short",
      timeZone: "UTC",
    });

    if (month !== previousMonth) {
      labels.push({
        column: index + 1,
        label: month,
      });
      previousMonth = month;
    }
  });

  return labels;
}

function buildGithubStatusMessage(github) {
  if (github.status === "live") {
    return "";
  }

  if (github.status === "stale") {
    return "Showing the most recent successful GitHub snapshot because the latest refresh failed.";
  }

  return "GitHub cards are using placeholder data until a portfolio token is configured in GitHub Actions.";
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatDecimal(value) {
  return Number(value || 0).toFixed(1);
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "Date unavailable";
  }
  return new Date(dateValue).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDateTime(dateValue, timeZone = "UTC") {
  if (!dateValue) {
    return "Unknown";
  }
  return new Date(dateValue).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderLoading() {
  app.innerHTML = loadingTemplate.innerHTML;
}
