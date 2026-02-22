@echo off
REM Samsara Data Sync Script
REM This batch file runs the Python sync script and logs the output

REM Change to the project directory
cd /d "C:\Users\thomasenglish\Desktop\ProjectProgressandPO"

REM Create logs directory if it doesn't exist
if not exist "logs" mkdir logs

REM Set log file with timestamp
set TIMESTAMP=%date:~-4,4%%date:~-10,2%%date:~-7,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%
set LOGFILE=logs\sync_%TIMESTAMP%.log

REM Run the Python sync script and log output
echo ======================================== >> %LOGFILE%
echo Samsara Sync Started: %date% %time% >> %LOGFILE%
echo ======================================== >> %LOGFILE%

python sync_samsara_data.py >> %LOGFILE% 2>&1

REM Check exit code
if %ERRORLEVEL% EQU 0 (
    echo Sync completed successfully at %time% >> %LOGFILE%
    exit /b 0
) else (
    echo Sync failed with error code %ERRORLEVEL% at %time% >> %LOGFILE%
    exit /b 1
)
