@echo off
title Adele Care - voice agent (close this window to stop it)
cd /d "%~dp0.."
if not exist logs mkdir logs
echo The voice agent is running. Its log is in logs\agent.log (shown in the "agent log" window).
echo Close this window to stop the agent.
rem Output goes to a file, not this console: a busy or paused Windows console stalls the agent
rem (clicking in the window pauses it), which makes the voice crackle and drop words.
".venv\Scripts\python.exe" agent\agent.py start >> logs\agent.log 2>&1
echo.
echo The agent stopped - see logs\agent.log.
pause
