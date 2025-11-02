# Script to update OpenAI API key in both locations
# Usage: .\update-openai-key.ps1 "your-new-api-key-here"

param(
    [Parameter(Mandatory=$true)]
    [string]$ApiKey
)

Write-Host "Updating OpenAI API Key..." -ForegroundColor Cyan

# Update frontend .env file
$frontendEnvPath = ".\.env"
if (Test-Path $frontendEnvPath) {
    $content = Get-Content $frontendEnvPath -Raw
    $content = $content -replace 'REACT_APP_OPENAI_API_KEY=.*', "REACT_APP_OPENAI_API_KEY=$ApiKey"
    Set-Content -Path $frontendEnvPath -Value $content -NoNewline
    Write-Host "✓ Updated frontend .env file" -ForegroundColor Green
} else {
    Write-Host "✗ Frontend .env file not found" -ForegroundColor Red
}

# Update functions .env file
$functionsEnvPath = ".\functions\.env"
if (Test-Path $functionsEnvPath) {
    $content = Get-Content $functionsEnvPath -Raw
    $content = $content -replace 'OPENAI_API_KEY=.*', "OPENAI_API_KEY=$ApiKey"
    Set-Content -Path $functionsEnvPath -Value $content -NoNewline
    Write-Host "✓ Updated functions .env file" -ForegroundColor Green
} else {
    Write-Host "✗ Functions .env file not found" -ForegroundColor Red
}

# Update Firebase functions config
Write-Host "`nUpdating Firebase Functions config..." -ForegroundColor Cyan
firebase functions:config:set openai.apikey="$ApiKey"

Write-Host "`n✓ API Key updated successfully!" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. Run: firebase deploy --only functions:analyzeFormEntries" -ForegroundColor White
Write-Host "2. Restart your dev server if running" -ForegroundColor White
