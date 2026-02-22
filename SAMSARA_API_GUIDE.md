# Samsara API Guide for AT11 Passive Trackers

## Overview

This Python client connects to the Samsara API to retrieve location data from AT11 passive trackers. The AT11 is a battery-powered Bluetooth asset tag that reports its location when in range of Samsara gateways.

## Authentication

All requests use Bearer token authentication:
```
Authorization: Bearer <your_api_token>
```

Base URL: `https://api.samsara.com`

## Key Endpoints

### 1. Get All Assets
```
GET /assets
```
Returns all assets including vehicles, trailers, and unpowered assets (AT11 trackers).

Response structure:
```json
{
  "data": [
    {
      "id": "281474999387855",
      "name": "Condensate Tank-JP3",
      "type": "unpowered",
      "createdAtTime": "2025-11-17T21:10:29Z",
      "updatedAtTime": "2026-01-15T18:40:28Z"
    }
  ]
}
```

**Filtering for AT11 trackers:** Filter where `type == "unpowered"`

### 2. Get Asset Location History
```
GET /assets/location-and-speed/stream?startTime=<ISO_TIME>&ids=<comma_separated_ids>
```

Parameters:
- `startTime` (required): ISO 8601 timestamp (e.g., `2024-01-15T00:00:00Z`)
- `ids` (optional): Comma-separated asset IDs to filter

Response structure:
```json
{
  "data": [
    {
      "happenedAtTime": "2026-01-15T14:09:21Z",
      "asset": {"id": "281474999387855"},
      "location": {
        "latitude": 29.832962,
        "longitude": -95.138394,
        "headingDegrees": 0,
        "accuracyMeters": 191.719
      }
    }
  ]
}
```

## Python Client Usage

### Setup
```python
from samsara_client import SamsaraClient

client = SamsaraClient()  # Reads token from .env file
```

### Get All Passive Trackers
```python
trackers = client.get_passive_trackers()
# Returns list of AT11 assets (type == "unpowered")
```

### Get Latest Locations for All Passive Trackers
```python
locations = client.get_passive_tracker_locations(hours=24)
```

Returns:
```python
[
    {
        "id": "281474999387855",
        "name": "Condensate Tank-JP3",
        "location": {
            "latitude": 29.832962,
            "longitude": -95.138394
        },
        "timestamp": "2026-01-15T14:09:21Z"
    },
    # ... more trackers
]
```

### Raw API Calls
```python
# Get all assets
assets = client.get("/assets")

# Get location history for specific assets
locations = client.get("/assets/location-and-speed/stream", params={
    "startTime": "2024-01-15T00:00:00Z",
    "ids": "281474999387855,281474999387857"
})
```

## Environment Setup

Create a `.env` file:
```
SAMSARA_API_TOKEN=your_token_here
```

Install dependencies:
```bash
pip install requests python-dotenv
```

## Data Flow Summary

1. Call `/assets` to get all assets
2. Filter for `type == "unpowered"` to get AT11 trackers
3. Extract asset IDs
4. Call `/assets/location-and-speed/stream` with those IDs and a start time
5. Parse response to get latest location per tracker

## Notes

- AT11 trackers only report location when in range of a Samsara gateway
- Some trackers may not have recent location data if they haven't been near a gateway
- The `accuracyMeters` field indicates GPS precision (lower = more accurate)
