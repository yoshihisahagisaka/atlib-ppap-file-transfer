param(
  [string]$OutputDirectory = (Join-Path (Get-Location) 'secure-send-evidence'),
  [string]$Project = 'msp-zabbix',
  [string]$Region = 'asia-northeast1'
)

# USER-RUN ONLY. This script was not executed against Production during review.
# No auth setup, IAM writes, API enablement, secrets, object listing or DB queries.
$ErrorActionPreference = 'Stop'
$targetDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
$utf8Encoding = [System.Text.UTF8Encoding]::new($false)

function Save-ReadOnlyEvidence {
  param([string]$FileName, [string[]]$GcloudArguments)
  $outputPath = Join-Path $targetDirectory $FileName
  if (Test-Path -LiteralPath $outputPath) {
    throw "Output already exists; choose a fresh output directory: $outputPath"
  }
  $content = & gcloud.cmd @GcloudArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Read-only gcloud request failed. No authentication or permission changes were attempted."
  }
  $json = $content -join [Environment]::NewLine
  $null = $json | ConvertFrom-Json
  [System.IO.File]::WriteAllText($outputPath, $json, $utf8Encoding)
  Write-Output "Saved $FileName"
}

foreach ($serviceName in @('ppap-upload-service','ppap-download-service','ppap-virus-scan')) {
  Save-ReadOnlyEvidence -FileName "$serviceName.json" -GcloudArguments @(
    'run','services','describe',$serviceName,"--project=$Project","--region=$Region",
    '--format=json(metadata.name,spec.template.metadata.annotations,spec.template.spec.containerConcurrency,spec.template.spec.timeoutSeconds,spec.template.spec.containers.resources,status.latestReadyRevisionName,status.traffic)'
  )
}

Save-ReadOnlyEvidence -FileName 'sql-instance-settings.json' -GcloudArguments @(
  'sql','instances','describe','msp-customer-portal-db',"--project=$Project",
  '--format=json(name,region,databaseVersion,settings.tier,settings.availabilityType,settings.backupConfiguration,settings.dataDiskSizeGb,settings.dataDiskType,settings.databaseFlags)'
)

Save-ReadOnlyEvidence -FileName 'storage-bucket-settings.json' -GcloudArguments @(
  'storage','buckets','describe','gs://atlib-ppap-file-transfer',"--project=$Project",
  '--format=json(name,location,default_storage_class,lifecycle_config,soft_delete_policy,versioning,uniform_bucket_level_access,public_access_prevention)'
)

Write-Output 'Read-only configuration collection completed. Billing, metrics and anonymous SQL aggregates are separate steps.'
