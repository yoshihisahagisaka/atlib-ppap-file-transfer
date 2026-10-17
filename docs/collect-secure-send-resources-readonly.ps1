param([string]$OutputDirectory = (Join-Path (Get-Location) 'secure-send-resources'))
$ErrorActionPreference = 'Stop'
$resolvedDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $resolvedDirectory -Force | Out-Null
$encoding = [System.Text.UTF8Encoding]::new($false)

foreach ($service in @('ppap-upload-service','ppap-download-service','ppap-virus-scan')) {
  $destination = Join-Path $resolvedDirectory "$service-resources.json"
  if (Test-Path -LiteralPath $destination) { throw "Output already exists: $destination" }
  # Flatten array before projecting resources. Environment variables are excluded.
  $jsonLines = & gcloud.cmd run services describe $service --project=msp-zabbix --region=asia-northeast1 `
    '--flatten=spec.template.spec.containers[]' `
    '--format=json(metadata.name,spec.template.spec.containers.resources,spec.template.metadata.annotations)'
  if ($LASTEXITCODE -ne 0) { throw 'Read-only gcloud request failed.' }
  $text = $jsonLines -join [Environment]::NewLine
  $decoded = $text | ConvertFrom-Json
  $items = @($decoded)
  foreach ($item in $items) {
    if ($null -eq $item.spec.template.spec.containers.resources) {
      throw "Resource projection is missing for $service. No file saved."
    }
  }
  [System.IO.File]::WriteAllText($destination, $text, $encoding)
  Write-Output "Saved $service-resources.json"
}
