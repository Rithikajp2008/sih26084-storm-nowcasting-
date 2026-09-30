# Real-data readiness matrix

| Source | Adapter | Default state | What is needed |
|---|---|---|---|
| IMD current weather | IMDAdapter | LIVE/ERROR depending on endpoint access | official API access if required |
| IMD AWS/ARG | IMDAdapter | LIVE/ERROR depending on endpoint access | official API access if required |
| IMD nowcast | IMDAdapter | available through adapter | official access |
| IMD DWR | IMDRadarAdapter | NOT_CONNECTED | authorized machine-readable radar product/feed + parser mapping |
| MOSDAC / INSAT | MOSDACAdapter / INSATAdapter | NOT_CONNECTED until configured | MOSDAC account, datasetId, permitted NRT access |
| Lightning | LightningAdapter | NOT_CONNECTED | lawful provider/API |
| Historical data | ML scripts | user supplied | verified observations + labels |

The matrix is intentionally conservative: a website page is not represented as a structured API unless its machine-readable interface is documented.
