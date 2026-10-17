@echo off
rem Lets `crawlit` work from cmd.exe and PowerShell without changing the execution policy
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0crawlit.ps1" %*
