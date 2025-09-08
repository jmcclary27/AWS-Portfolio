@echo off
setlocal
echo [task start %date% %time%] >> C:\Users\jaden\AWS-Portfolio\resume_watcher.log
cd /d C:\Users\jaden\AWS-Portfolio
set "PATH=C:\Program Files\Amazon\AWSCLIV2;C:\Program Files\Git\cmd;%PATH%"
"C:\Users\jaden\anaconda3\envs\siteEnv\python.exe" "C:\Users\jaden\AWS-Portfolio\resume_watcher.py" >> C:\Users\jaden\AWS-Portfolio\resume_watcher.log 2>&1
endlocal
