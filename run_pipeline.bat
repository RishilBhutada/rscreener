@echo off
cd /d "%~dp0"
python pipeline\fetch_universe.py
python pipeline\fetch_fundamentals.py --all
pause
