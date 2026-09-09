// alerts.bicep -- Drift detection rules, the Azure analogue of
// splunk/detectors.json.
//
// The three Splunk detectors compare a 5-minute mean against a 1-hour mean
// plus or minus 3 standard deviations, and require the breach to last 5
// minutes. These reproduce that logic faithfully. The mapping:
//
//   mean(over='5m')            -> windowSize PT5M (the aggregation
//                                 granularity, and the bin() size in KQL)
//   mean/stddev(over='1h')     -> overrideQueryTimeRange PT1H
//   lasting='5m'               -> failingPeriods 2 of 2, i.e. two
//                                 consecutive 5-minute points
//   severity: Warning          -> severity 2
//   notifications: []          -> empty actions.actionGroups
//
// THREE THINGS THAT ARE NOT OBVIOUS AND COST A FAILED DEPLOYMENT:
//
//   1. numberOfEvaluationPeriods > 1 REQUIRES the query to project a
//      column literally named `timestamp` of type datetime. Without it
//      the deployment fails with "Number of evaluation periods must be 1
//      for queries that do not project the 'timestamp' column of type
//      'datetime'". So each query bins into 5-minute buckets and emits
//      one row per breaching bucket, rather than one scalar summary row.
//
//   2. An evaluation period is windowSize, NOT evaluationFrequency. With
//      windowSize PT1H and 2 periods the lookback would be two hours.
//      windowSize is therefore PT5M here.
//
//   3. The query time range defaults to
//      windowSize * numberOfEvaluationPeriods, which would be 10 minutes
//      -- far too short for a 1-hour baseline. overrideQueryTimeRange
//      PT1H decouples the two.
//
// Rules fire on rows returned: timeAggregation Count, operator
// GreaterThan, threshold 0. Each 5-minute bin yields one row when it
// breaches and none when it does not, so a bin either fails or passes.
//
// TWO DELIBERATE DIFFERENCES FROM THE SPLUNK VERSIONS:
//
//   1. Two of the three read SPAN ATTRIBUTES (the dependencies table),
//      not customMetrics. Standard deviation cannot be recovered from
//      customMetrics: taking stdev() of pre-aggregated per-interval means
//      is not the stdev of the population, and it silently understates
//      variance, giving a hair-trigger detector. The dependencies table
//      holds one row per call, so avg() and stdev() are both true.
//
//   2. Each rule carries sample-size and non-zero-sigma guards
//      (n >= 30, m >= 5, sigma > 0) that the Splunk versions lack.
//      Without them, a cold-start hour containing four LLM calls fires
//      every rule immediately.
//
// A STRUCTURAL LIMIT, not a tuning problem: scheduled query rules have a
// floor of 5-minute evaluation plus Log Analytics ingestion latency
// (typically 1 to 3 minutes). Splunk evaluates on its streaming metric
// pipeline, seconds behind. Azure will detect the same drift later.
// See docs/splunk-vs-azure-monitor.md.
//
// Metric alerts with Dynamic Thresholds are NOT the analogue here: they
// require the metric to live in the Azure Monitor metrics namespace
// (customMetrics is log-based), and Dynamic Thresholds is a seasonality
// model rather than 3-sigma, so it would not be a like-for-like
// comparison of the same detection logic.
//
// No action groups are wired up, matching the empty notification lists on
// the Splunk detectors. Add them when someone should actually be paged.

@description('Name of the existing Application Insights resource to evaluate.')
param appInsightsName string

@description('Region for the alert rules. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Set false to deploy the rules in a disabled state.')
param rulesEnabled bool = true

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

// Shared shape: build the population once over the 1-hour query range,
// derive a baseline from it, then bin the same range into 5-minute points
// and emit a row for each point sitting outside baseline +/- 3 sigma.
// The `timestamp` column name is mandatory -- see note 1 in the header.
var responseLengthQuery = '''
let population = dependencies
    | where cloud_RoleName == 'rag-api'
    | extend v = tolong(tostring(customDimensions['gen_ai.response.length']))
    | where isnotnull(v);
let baseline = population
    | summarize mu = avg(v), sigma = stdev(v), n = count();
population
| summarize short_mu = avg(v), m = count() by timestamp = bin(timestamp, 5m)
| extend joinkey = 1
| join kind=inner (baseline | extend joinkey = 1) on joinkey
| where n >= 30 and m >= 5 and sigma > 0
| where short_mu > mu + 3 * sigma or short_mu < mu - 3 * sigma
| project timestamp, short_mu, mu, sigma, n, m
'''

var outputTokenQuery = '''
let population = dependencies
    | where cloud_RoleName == 'rag-api'
    | where tostring(customDimensions['gen_ai.operation.name']) == 'chat'
    | extend v = tolong(tostring(customDimensions['gen_ai.usage.output_tokens']))
    | where isnotnull(v);
let baseline = population
    | summarize mu = avg(v), sigma = stdev(v), n = count();
population
| summarize short_mu = avg(v), m = count() by timestamp = bin(timestamp, 5m)
| extend joinkey = 1
| join kind=inner (baseline | extend joinkey = 1) on joinkey
| where n >= 30 and m >= 5 and sigma > 0
| where short_mu > mu + 3 * sigma or short_mu < mu - 3 * sigma
| project timestamp, short_mu, mu, sigma, n, m
'''

// One-sided, matching the Splunk latency detector: only a slowdown is
// interesting. requests.duration is already per-request, so no span
// attribute extraction is needed here.
var latencyQuery = '''
let population = requests
    | where cloud_RoleName == 'rag-api';
let baseline = population
    | summarize mu = avg(duration), sigma = stdev(duration), n = count();
population
| summarize short_mu = avg(duration), m = count() by timestamp = bin(timestamp, 5m)
| extend joinkey = 1
| join kind=inner (baseline | extend joinkey = 1) on joinkey
| where n >= 30 and m >= 5 and sigma > 0
| where short_mu > mu + 3 * sigma
| project timestamp, short_mu, mu, sigma, n, m
'''

var rules = [
  {
    name: 'rag-api-response-length-anomaly'
    displayName: 'LLM -- Response Length Anomaly'
    description: 'Mean gen_ai.response.length over a 5-minute point is more than 3 standard deviations from the 1-hour baseline, for two consecutive points. A sustained shift can signal model drift or a prompt regression.'
    query: responseLengthQuery
  }
  {
    name: 'rag-api-output-token-anomaly'
    displayName: 'LLM -- Output Token Anomaly'
    description: 'Mean completion tokens per chat call over a 5-minute point is more than 3 standard deviations from the 1-hour baseline, for two consecutive points. Watches for runaway generations and for unexpectedly truncated ones.'
    query: outputTokenQuery
  }
  {
    name: 'rag-api-latency-anomaly'
    displayName: 'LLM -- Latency Anomaly'
    description: 'Mean request duration over a 5-minute point is more than 3 standard deviations above the 1-hour baseline, for two consecutive points. One-sided: only slowdowns alert.'
    query: latencyQuery
  }
]

resource driftRules 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for rule in rules: {
  name: rule.name
  location: location
  kind: 'LogAlert'
  tags: {
    Component: 'rag-api'
    Purpose: 'drift-detection'
  }
  properties: {
    displayName: rule.displayName
    description: rule.description
    // 2 = Warning, matching the Splunk detectors.
    severity: 2
    enabled: rulesEnabled
    scopes: [
      appInsights.id
    ]
    // Aggregation granularity, and therefore the size of ONE evaluation
    // period. Matches the bin() size in every query above.
    windowSize: 'PT5M'
    evaluationFrequency: 'PT5M'
    // Without this the query would only see
    // windowSize * numberOfEvaluationPeriods = 10 minutes, and the
    // 1-hour baseline would silently become a 10-minute one.
    overrideQueryTimeRange: 'PT1H'
    criteria: {
      allOf: [
        {
          query: rule.query
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          // The Splunk equivalent of lasting='5m': two consecutive
          // 5-minute points must breach before the alert fires, so a
          // single noisy bin does not page anyone.
          failingPeriods: {
            numberOfEvaluationPeriods: 2
            minFailingPeriodsToAlert: 2
          }
        }
      ]
    }
    autoMitigate: true
    // Deliberately empty, matching splunk/detectors.json.
    actions: {
      actionGroups: []
    }
  }
}]

output ruleNames array = [for (rule, i) in rules: driftRules[i].name]
