param([string]$OutputDirectory = (Join-Path (Get-Location) 'secure-send-metrics'))
# User-run, read-only Monitoring API GETs. No SQL, Logging, object access or cloud writes.
# Existing gcloud login is used. Access token remains in process memory only.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$directory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$destination = Join-Path $directory 'metrics-summary.json'
if (Test-Path -LiteralPath $destination) { throw "Output already exists: $destination" }
$encoding = [System.Text.UTF8Encoding]::new($false)
$project = 'msp-zabbix'
$baseUrl = "https://monitoring.googleapis.com/v3/projects/$project"
$tokenLines = & gcloud.cmd auth print-access-token --quiet
if ($LASTEXITCODE -ne 0) { throw 'Existing gcloud authentication could not supply Monitoring access.' }
$monitoringToken = ($tokenLines -join '').Trim()
if ([string]::IsNullOrWhiteSpace($monitoringToken)) { throw 'No access token supplied.' }
$headers = @{ Authorization = "Bearer $monitoringToken" }
$results = [System.Collections.Generic.List[object]]::new()
$collectedAt = [DateTimeOffset]::UtcNow
$delayed = $collectedAt.AddMinutes(-15)
$partialEnd = [DateTimeOffset]::Parse($delayed.ToString('yyyy-MM-ddTHH:00:00Z'))
$periods = @(
  @{ Name='2026-07'; Start='2026-07-01T00:00:00+09:00'; End='2026-08-01T00:00:00+09:00' },
  @{ Name='2026-08'; Start='2026-08-01T00:00:00+09:00'; End='2026-09-01T00:00:00+09:00' },
  @{ Name='2026-09'; Start='2026-09-01T00:00:00+09:00'; End='2026-10-01T00:00:00+09:00' },
  @{ Name='2026-10-partial'; Start='2026-10-01T00:00:00+09:00'; End=$partialEnd.ToString('o') }
)

function Save-Checkpoint {
  $payload = [ordered]@{
    collectedAtUtc=$collectedAt.ToString('o'); project=$project;
    note='Monitoring aggregates, not invoices. NoData does not mean zero. SQL metrics cover the shared instance, not Secure Send alone. GCS sent bytes include scan/internal reads and are not automatically internet egress. Hourly means/maxima are not scan p95 or exact request concurrency peaks.';
    results=@($results.ToArray())
  }
  [System.IO.File]::WriteAllText($destination, ($payload | ConvertTo-Json -Depth 30), $encoding)
}

function Get-MonitoringJson {
  param([string]$Uri)
  try { return Invoke-RestMethod -Method Get -Uri $Uri -Headers $headers -TimeoutSec 60 }
  catch {
    $httpStatus = 0
    if ($_.Exception.Response) { $httpStatus = [int]$_.Exception.Response.StatusCode }
    if ($httpStatus -eq 401 -or $httpStatus -eq 403) {
      Save-Checkpoint
      throw "Monitoring HTTP $httpStatus. Stopped without enabling APIs or changing permissions. Check monitoring.timeSeries.list and metricDescriptors.get."
    }
    return [pscustomobject]@{ CollectionError=$true; HttpStatus=$httpStatus }
  }
}

$queries = [System.Collections.Generic.List[object]]::new()
foreach ($service in @('ppap-upload-service','ppap-download-service','ppap-virus-scan')) {
  foreach ($metric in @('run.googleapis.com/container/billable_instance_time','run.googleapis.com/container/cpu/allocation_time','run.googleapis.com/container/memory/allocation_time','run.googleapis.com/request_count')) {
    $queries.Add(@{ Scope=$service; Metric=$metric; Resource='cloud_run_revision'; Selector=('resource.labels.service_name="{0}" AND resource.labels.location="asia-northeast1"' -f $service); Gauge='MEAN' })
  }
}
foreach ($metric in @('storage.googleapis.com/network/received_bytes_count','storage.googleapis.com/network/sent_bytes_count','storage.googleapis.com/storage/v2/total_bytes','storage.googleapis.com/api/request_count')) {
  $queries.Add(@{ Scope='atlib-ppap-file-transfer'; Metric=$metric; Resource='gcs_bucket'; Selector='resource.labels.bucket_name="atlib-ppap-file-transfer"'; Gauge='MEAN' })
}
foreach ($metric in @('cloudsql.googleapis.com/database/cpu/utilization','cloudsql.googleapis.com/database/disk/bytes_used','cloudsql.googleapis.com/database/postgresql/num_backends')) {
  $gaugeMode = if ($metric.EndsWith('/num_backends')) { 'MEAN' } else { 'MAX' }
  $queries.Add(@{ Scope='msp-customer-portal-db-SHARED'; Metric=$metric; Resource='cloudsql_database'; Selector='resource.labels.database_id="msp-zabbix:msp-customer-portal-db"'; Gauge=$gaugeMode; SumSeries=$metric.EndsWith('/num_backends') })
}

$descriptorCache = @{}
try {
  foreach ($query in $queries) {
    $metricType = $query.Metric
    if (-not $descriptorCache.ContainsKey($metricType)) {
      $encodedType = [Uri]::EscapeDataString($metricType)
      $descriptorCache[$metricType] = Get-MonitoringJson -Uri "$baseUrl/metricDescriptors/$encodedType"
    }
    $descriptor = $descriptorCache[$metricType]
    if ($descriptor.CollectionError -or $descriptor.valueType -eq 'DISTRIBUTION' -or $descriptor.metricKind -eq 'CUMULATIVE') {
      $results.Add([pscustomobject]@{ scope=$query.Scope; metric=$metricType; status='DescriptorUnavailableOrUnsupported'; httpStatus=$descriptor.HttpStatus })
      Save-Checkpoint
      continue
    }
    foreach ($period in $periods) {
      $isDelta = $descriptor.metricKind -eq 'DELTA'
      $aligner = if ($isDelta) { 'ALIGN_SUM' } elseif ($query.Gauge -eq 'MAX') { 'ALIGN_MAX' } else { 'ALIGN_MEAN' }
      $reducer = if ($isDelta -or $query.Resource -eq 'gcs_bucket' -or $query.SumSeries) { 'REDUCE_SUM' } elseif ($query.Gauge -eq 'MAX') { 'REDUCE_MAX' } else { 'REDUCE_MEAN' }
      $filter = 'metric.type="{0}" AND resource.type="{1}" AND {2}' -f $metricType,$query.Resource,$query.Selector
      $parameters = [ordered]@{
        filter=$filter; 'interval.startTime'=([DateTimeOffset]::Parse($period.Start).UtcDateTime.ToString('o'));
        'interval.endTime'=([DateTimeOffset]::Parse($period.End).UtcDateTime.ToString('o'));
        'aggregation.alignmentPeriod'='3600s'; 'aggregation.perSeriesAligner'=$aligner;
        'aggregation.crossSeriesReducer'=$reducer; view='FULL'; pageSize='1000'
      }
      $seriesOutput = [System.Collections.Generic.List[object]]::new()
      $pageToken = ''; $pages = 0; $requestFailed = $false
      do {
        if ($pageToken) { $parameters['pageToken']=$pageToken }
        $qs = ($parameters.GetEnumerator() | ForEach-Object { [Uri]::EscapeDataString([string]$_.Key)+'='+[Uri]::EscapeDataString([string]$_.Value) }) -join '&'
        $response = Get-MonitoringJson -Uri "$baseUrl/timeSeries?$qs"
        if ($response.CollectionError) { $requestFailed=$true; break }
        foreach ($series in $response.timeSeries) {
          # Drop all labels and names. Only hourly interval+numeric values remain.
          $points = @($series.points | ForEach-Object { [pscustomobject]@{ interval=$_.interval; value=$_.value } })
          $seriesOutput.Add([pscustomobject]@{ points=$points })
        }
        $pageToken=$response.nextPageToken; $pages++
        if ($pages -ge 20 -and $pageToken) { throw 'Pagination safety limit reached. Partial values are not complete totals.' }
      } while ($pageToken)
      $status = if ($requestFailed) { 'RequestFailed' } elseif ($seriesOutput.Count -eq 0) { 'NoData' } else { 'Collected' }
      $results.Add([pscustomobject]@{ scope=$query.Scope; metric=$metricType; period=$period.Name; start=$period.Start; end=$period.End; status=$status; metricKind=$descriptor.metricKind; valueType=$descriptor.valueType; unit=$descriptor.unit; aligner=$aligner; reducer=$reducer; series=@($seriesOutput.ToArray()) })
      Save-Checkpoint
      Write-Output ("{0}: {1} {2} {3}" -f $status,$query.Scope,$period.Name,$metricType)
    }
  }
  Write-Output 'Read-only Monitoring collection completed. Billing CSV and business-level SQL aggregates remain separate.'
} finally {
  $headers.Clear(); $monitoringToken=$null; $tokenLines=$null
}
