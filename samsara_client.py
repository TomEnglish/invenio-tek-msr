"""
Samsara API Client for AT11 Passive Tracker Integration
Fetches asset location data from Samsara API and syncs to Supabase
"""

import os
import requests
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class SamsaraClient:
    """Client for interacting with Samsara API"""

    BASE_URL = "https://api.samsara.com"
    SHARE_URL_BASE = "https://cloud.samsara.com/o/4009326/fleet/viewer"

    def __init__(self, api_token: Optional[str] = None):
        """
        Initialize Samsara client

        Args:
            api_token: Samsara API token. If None, reads from .env file
        """
        self.api_token = api_token or os.getenv('SAMSARA_API_TOKEN') or os.getenv('Samsara API Token')

        if not self.api_token:
            raise ValueError("Samsara API token not found. Set SAMSARA_API_TOKEN in .env file")

        # Note: Samsara API tokens typically start with 'samsara_api_' - this is expected

        self.headers = {
            'Authorization': f'Bearer {self.api_token}',
            'Accept': 'application/json'
        }

    def _make_request(self, method: str, endpoint: str, params: Optional[Dict] = None) -> Dict:
        """
        Make HTTP request to Samsara API

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint (e.g., '/assets')
            params: Query parameters

        Returns:
            JSON response as dictionary
        """
        url = f"{self.BASE_URL}{endpoint}"

        try:
            response = requests.request(
                method=method,
                url=url,
                headers=self.headers,
                params=params,
                timeout=30
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Error making request to {endpoint}: {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"Response: {e.response.text}")
            raise

    def get(self, endpoint: str, params: Optional[Dict] = None) -> Dict:
        """Make GET request"""
        return self._make_request('GET', endpoint, params)

    def get_all_assets(self) -> List[Dict]:
        """
        Get all assets from Samsara

        Returns:
            List of asset dictionaries
        """
        response = self.get('/assets')
        return response.get('data', [])

    def get_passive_trackers(self) -> List[Dict]:
        """
        Get all passive trackers (AT11 devices - type 'unpowered')

        Returns:
            List of passive tracker dictionaries with id, name, type
        """
        all_assets = self.get_all_assets()

        # Filter for unpowered assets (AT11 trackers)
        trackers = [
            asset for asset in all_assets
            if asset.get('type') == 'unpowered'
        ]

        print(f"Found {len(trackers)} passive trackers out of {len(all_assets)} total assets")
        return trackers

    def get_location_history(self, asset_ids: List[str], hours_back: int = 24) -> List[Dict]:
        """
        Get location history for specified assets with pagination support

        Args:
            asset_ids: List of asset IDs to query
            hours_back: How many hours back to query (default 24)

        Returns:
            List of location events
        """
        if not asset_ids:
            return []

        # Calculate start time
        start_time = datetime.utcnow() - timedelta(hours=hours_back)
        start_time_iso = start_time.strftime('%Y-%m-%dT%H:%M:%SZ')

        all_events = []
        after = None

        # Paginate through all results
        while True:
            params = {
                'startTime': start_time_iso,
                'ids': ','.join(asset_ids),
                'limit': 512  # Max allowed by Samsara API
            }

            if after:
                params['after'] = after

            response = self.get('/assets/location-and-speed/stream', params)
            events = response.get('data', [])

            if not events:
                break

            all_events.extend(events)

            # Check for pagination cursor
            pagination = response.get('pagination', {})
            after = pagination.get('endCursor')

            if not after or not pagination.get('hasNextPage', False):
                break

        return all_events

    def get_passive_tracker_locations(self, hours_back: int = 24) -> List[Dict]:
        """
        Get latest locations for all passive trackers

        Args:
            hours_back: How many hours back to query (default 24)

        Returns:
            List of tracker dictionaries with location data:
            [
                {
                    'id': '281474999387855',
                    'name': 'Condensate Tank-JP3',
                    'type': 'unpowered',
                    'location': {
                        'latitude': 29.832962,
                        'longitude': -95.138394,
                        'accuracy_meters': 191.719
                    },
                    'timestamp': '2026-01-15T14:09:21Z',
                    'share_link': 'https://cloud.samsara.com/o/4009326/fleet/viewer/...'
                }
            ]
        """
        # Get all passive trackers
        trackers = self.get_passive_trackers()

        if not trackers:
            print("No passive trackers found")
            return []

        # Get asset IDs
        asset_ids = [tracker['id'] for tracker in trackers]

        # Get location history
        location_events = self.get_location_history(asset_ids, hours_back)

        # Build a map of latest location per asset
        latest_locations = {}
        for event in location_events:
            asset_id = event.get('asset', {}).get('id')
            timestamp = event.get('happenedAtTime')

            if not asset_id or not timestamp:
                continue

            # Keep only the latest location for each asset
            if asset_id not in latest_locations or timestamp > latest_locations[asset_id]['timestamp']:
                latest_locations[asset_id] = {
                    'timestamp': timestamp,
                    'location': event.get('location', {})
                }

        # Combine tracker info with location data
        result = []
        for tracker in trackers:
            tracker_id = tracker['id']
            tracker_data = {
                'id': tracker_id,
                'name': tracker.get('name', 'Unknown'),
                'type': tracker.get('type', 'unpowered'),
                'created_at': tracker.get('createdAtTime'),
                'updated_at': tracker.get('updatedAtTime'),
                'location': None,
                'timestamp': None,
                'share_link': None
            }

            # Add location if available
            if tracker_id in latest_locations:
                loc_data = latest_locations[tracker_id]
                location = loc_data.get('location', {})

                tracker_data['location'] = {
                    'latitude': location.get('latitude'),
                    'longitude': location.get('longitude'),
                    'accuracy_meters': location.get('accuracyMeters', 0)
                }
                tracker_data['timestamp'] = loc_data['timestamp']

                # Construct share link (using asset ID or gateway ID if available)
                # The link format appears to be: https://cloud.samsara.com/o/4009326/fleet/viewer/{IDENTIFIER}
                # We'll try to extract the identifier from the asset data
                tracker_data['share_link'] = f"{self.SHARE_URL_BASE}/{tracker.get('externalIds', {}).get('default', tracker_id)}"

            result.append(tracker_data)

        print(f"Retrieved locations for {len(latest_locations)} out of {len(trackers)} trackers")
        return result

    def calculate_distance_from_site(self, lat: float, lon: float, site_lat: float, site_lon: float) -> float:
        """
        Calculate distance between two coordinates using Haversine formula

        Args:
            lat: Tracker latitude
            lon: Tracker longitude
            site_lat: Site latitude
            site_lon: Site longitude

        Returns:
            Distance in kilometers
        """
        from math import radians, cos, sin, asin, sqrt

        # Convert to radians
        lat1, lon1, lat2, lon2 = map(radians, [lat, lon, site_lat, site_lon])

        # Haversine formula
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * asin(sqrt(a))

        # Earth radius in kilometers
        r = 6371

        return c * r


if __name__ == '__main__':
    # Test the client
    print("Testing Samsara API Client...")
    print("=" * 80)

    try:
        client = SamsaraClient()
        print("✓ Client initialized successfully")

        # Get passive trackers
        print("\nFetching passive trackers...")
        trackers = client.get_passive_tracker_locations(hours_back=168)  # Last 7 days

        print(f"\n✓ Found {len(trackers)} passive trackers")
        print("\nTracker Summary:")
        print("-" * 80)

        for tracker in trackers:
            print(f"\nName: {tracker['name']}")
            print(f"  ID: {tracker['id']}")

            if tracker['location']:
                loc = tracker['location']
                print(f"  Location: {loc['latitude']:.6f}, {loc['longitude']:.6f}")
                print(f"  Accuracy: {loc['accuracy_meters']:.1f}m")
                print(f"  Last Seen: {tracker['timestamp']}")

                if tracker['share_link']:
                    print(f"  Share Link: {tracker['share_link']}")
            else:
                print(f"  Location: No recent data (last 7 days)")

        print("\n" + "=" * 80)
        print("✓ Test completed successfully")

    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
