"""
Samsara Data Sync Script
Fetches tracker data from Samsara API and syncs to Supabase
Run this script hourly via cron/Task Scheduler or manually
"""

import os
import sys
import requests
from datetime import datetime
from dotenv import load_dotenv
from samsara_client import SamsaraClient

# Load environment variables
load_dotenv()

# Amarillo Frame 6B site coordinates
SITE_LATITUDE = 35.293    # Frame 6B Power Group site, Amarillo TX
SITE_LONGITUDE = -101.603
SITE_RADIUS_KM = 0.5  # 500m geofence radius (tighter perimeter)


class SamsaraSyncService:
    """Service for syncing Samsara data to Supabase"""

    def __init__(self):
        """Initialize sync service"""
        # Initialize Samsara client
        self.samsara = SamsaraClient()

        # Initialize Supabase REST API client
        self.supabase_url = os.getenv('SUPABASE_URL') or 'https://lmdomalnuzbvxxutpyky.supabase.co'
        self.supabase_key = os.getenv('SUPABASE_ANON_KEY') or os.getenv('supabase anon public')

        if not self.supabase_key:
            raise ValueError("Supabase credentials not found in .env file")

        self.supabase_headers = {
            'apikey': self.supabase_key,
            'Authorization': f'Bearer {self.supabase_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }

    def calculate_distance(self, lat: float, lon: float) -> float:
        """Calculate distance from site using Haversine formula"""
        return self.samsara.calculate_distance_from_site(lat, lon, SITE_LATITUDE, SITE_LONGITUDE)

    def is_on_site(self, lat: float, lon: float) -> bool:
        """Check if location is within site geofence"""
        distance = self.calculate_distance(lat, lon)
        return distance <= SITE_RADIUS_KM

    def sync_trackers(self, hours_back: int = 168) -> dict:
        """
        Sync tracker data from Samsara to Supabase

        Args:
            hours_back: How many hours of location history to fetch (default: 168 = 7 days)

        Returns:
            Dictionary with sync statistics
        """
        print("=" * 80)
        print("Samsara Data Sync Started")
        print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 80)

        stats = {
            'trackers_fetched': 0,
            'trackers_updated': 0,
            'trackers_created': 0,
            'locations_added': 0,
            'errors': 0
        }

        try:
            # Fetch tracker data from Samsara
            print("\n1. Fetching tracker data from Samsara API...")
            trackers = self.samsara.get_passive_tracker_locations(hours_back=hours_back)
            stats['trackers_fetched'] = len(trackers)
            print(f"   Found {len(trackers)} passive trackers")

            # Sync each tracker to Supabase
            print("\n2. Syncing trackers to Supabase...")

            for tracker in trackers:
                try:
                    tracker_id = tracker['id']
                    has_location = tracker['location'] is not None

                    # Prepare tracker data
                    tracker_data = {
                        'id': tracker_id,
                        'name': tracker['name'],
                        'type': tracker['type'],
                        'share_link': tracker.get('share_link'),
                        'created_at_samsara': tracker.get('created_at'),
                        'updated_at_samsara': tracker.get('updated_at'),
                        'synced_at': datetime.utcnow().isoformat()
                    }

                    # Add location data if available
                    if has_location:
                        loc = tracker['location']
                        lat = loc['latitude']
                        lon = loc['longitude']

                        tracker_data.update({
                            'last_latitude': lat,
                            'last_longitude': lon,
                            'last_accuracy_meters': loc['accuracy_meters'],
                            'last_seen_at': tracker['timestamp'],
                            'is_on_site': self.is_on_site(lat, lon),
                            'distance_from_site_km': round(self.calculate_distance(lat, lon), 2)
                        })

                    # Upsert tracker (insert or update) using REST API
                    upsert_url = f"{self.supabase_url}/rest/v1/samsara_trackers"
                    upsert_response = requests.post(
                        upsert_url,
                        headers={**self.supabase_headers, 'Prefer': 'resolution=merge-duplicates,return=representation'},
                        json=tracker_data
                    )

                    if upsert_response.status_code in [200, 201]:
                        # Determine if it was an insert or update based on response
                        result_data = upsert_response.json()
                        stats['trackers_updated'] += 1
                        print(f"   Synced: {tracker['name']}")

                        # Add to location history if location exists
                        if has_location:
                            loc_history = {
                                'tracker_id': tracker_id,
                                'latitude': lat,
                                'longitude': lon,
                                'accuracy_meters': loc['accuracy_meters'],
                                'happened_at': tracker['timestamp'],
                                'is_on_site': self.is_on_site(lat, lon),
                                'distance_from_site_km': round(self.calculate_distance(lat, lon), 2)
                            }

                            # Insert into history (ignore duplicates)
                            try:
                                history_url = f"{self.supabase_url}/rest/v1/samsara_location_history"
                                history_response = requests.post(
                                    history_url,
                                    headers=self.supabase_headers,
                                    json=loc_history
                                )
                                if history_response.status_code in [200, 201]:
                                    stats['locations_added'] += 1
                            except Exception as e:
                                # Likely a duplicate - that's OK
                                if 'duplicate key' not in str(e).lower():
                                    print(f"   Warning adding location history: {e}")
                    else:
                        print(f"   Error upserting tracker: {upsert_response.text}")
                        stats['errors'] += 1

                except Exception as e:
                    print(f"   Error syncing {tracker.get('name', 'unknown')}: {e}")
                    stats['errors'] += 1

            # Print summary
            print("\n" + "=" * 80)
            print("Sync Completed")
            print("=" * 80)
            print(f"Trackers fetched:  {stats['trackers_fetched']}")
            print(f"Trackers created:  {stats['trackers_created']}")
            print(f"Trackers updated:  {stats['trackers_updated']}")
            print(f"Locations added:   {stats['locations_added']}")
            print(f"Errors:            {stats['errors']}")
            print("=" * 80)

            # Get current statistics
            self._print_statistics()

            return stats

        except Exception as e:
            print(f"\nSync failed: {e}")
            import traceback
            traceback.print_exc()
            stats['errors'] += 1
            return stats

    def _print_statistics(self):
        """Print current tracker statistics"""
        try:
            stats_url = f"{self.supabase_url}/rest/v1/vw_samsara_tracker_stats"
            response = requests.get(stats_url, headers=self.supabase_headers)

            if response.status_code == 200:
                result = response.json()
                if result and len(result) > 0:
                    stats = result[0]

                    print("\nCurrent Tracker Statistics:")
                    print("-" * 80)
                    print(f"Total trackers:        {stats.get('total_trackers', 0)}")
                    print(f"Active (24h):          {stats.get('active_24h', 0)}")
                    print(f"Active (7d):           {stats.get('active_7d', 0)}")
                    print(f"On site:               {stats.get('on_site', 0)}")
                    print(f"In transit:            {stats.get('in_transit', 0)}")
                    print(f"Linked to materials:   {stats.get('linked_to_materials', 0)}")

                    if stats.get('most_recent_update'):
                        print(f"Most recent update:    {stats['most_recent_update']}")

                    print("-" * 80)

        except Exception as e:
            print(f"Could not fetch statistics: {e}")

    def get_tracker_status(self) -> dict:
        """
        Get current status of all trackers

        Returns:
            Dictionary with tracker status information
        """
        try:
            trackers_url = f"{self.supabase_url}/rest/v1/vw_active_samsara_trackers"
            response = requests.get(trackers_url, headers=self.supabase_headers)

            if response.status_code == 200:
                trackers = response.json()
                return {
                    'success': True,
                    'trackers': trackers,
                    'count': len(trackers)
                }
            else:
                return {
                    'success': False,
                    'error': f'HTTP {response.status_code}: {response.text}',
                    'trackers': [],
                    'count': 0
                }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'trackers': [],
                'count': 0
            }


def main():
    """Main execution function"""
    print("\n" + "=" * 80)
    print("SAMSARA TRACKER SYNC")
    print("=" * 80)

    try:
        # Create sync service
        sync_service = SamsaraSyncService()

        # Run sync (last 24 hours for most recent locations)
        stats = sync_service.sync_trackers(hours_back=24)

        # Exit with appropriate code
        if stats['errors'] > 0:
            print("\nSync completed with errors")
            sys.exit(1)
        else:
            print("\nSync completed successfully")
            sys.exit(0)

    except Exception as e:
        print(f"\nFatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(2)


if __name__ == '__main__':
    main()
