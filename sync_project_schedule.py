#!/usr/bin/env python3
"""
Sync Project Schedule to Supabase
Reads from P0203-PM-120-SCH-0002.xlsx and uploads to Supabase project_schedule table
"""

import os
import sys
import pandas as pd
import requests
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class ProjectScheduleSync:
    def __init__(self):
        self.supabase_url = os.getenv('SUPABASE_URL')
        self.supabase_key = os.getenv('SUPABASE_ANON_KEY')
        self.excel_file = 'P0203-PM-120-SCH-0002.xlsx'  # More detailed schedule

        if not self.supabase_url or not self.supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env file")

    def categorize_activity(self, activity_name):
        """Categorize activity based on name patterns"""
        if pd.isna(activity_name):
            return None

        name_lower = str(activity_name).lower()

        # Check keywords
        if any(word in name_lower for word in ['design', 'drawing', 'engineering', 'specification']):
            return 'Design/Engineering'
        elif any(word in name_lower for word in ['procurement', 'purchase', 'order', 'po']):
            return 'Procurement'
        elif any(word in name_lower for word in ['fabrication', 'manufacture', 'build']):
            return 'Fabrication'
        elif any(word in name_lower for word in ['ship', 'transport', 'delivery', 'barge', 'road']):
            return 'Transportation'
        elif any(word in name_lower for word in ['installation', 'install', 'erection', 'construct']):
            return 'Installation'
        elif any(word in name_lower for word in ['testing', 'test', 'commissioning', 'commission']):
            return 'Testing/Commissioning'
        elif any(word in name_lower for word in ['startup', 'first fire', 'synchronization']):
            return 'Startup'
        elif any(word in name_lower for word in ['complete', 'finish', 'award', 'mobilize', 'permit']):
            return 'Milestone'
        else:
            return 'Other'

    def parse_date(self, value):
        """Parse date from Excel, handling various formats"""
        if value is None or pd.isna(value):
            return None

        # If already a datetime
        if isinstance(value, (pd.Timestamp, datetime)):
            return value.strftime('%Y-%m-%d')

        # Try parsing as string
        try:
            value_str = str(value).strip()
            # Remove " A" suffix if present
            value_str = value_str.replace(' A', '')

            parsed_date = pd.to_datetime(value_str, errors='coerce')
            if not pd.isna(parsed_date):
                return parsed_date.strftime('%Y-%m-%d')
        except:
            pass

        return None

    def sync_schedule(self):
        """Sync project schedule data to Supabase"""
        print("\n" + "="*80)
        print("PROJECT SCHEDULE SYNC")
        print("="*80)
        print(f"Excel file: {os.path.abspath(self.excel_file)}")
        print(f"Supabase URL: {self.supabase_url}")
        print("="*80)

        try:
            # Read Excel file
            print("\n1. Reading schedule data from Excel...")
            df = pd.read_excel(self.excel_file)
            print(f"   Found {len(df)} activities")

            # Prepare records
            print("   Processing activities...")
            records = []

            for _, row in df.iterrows():
                # Parse dates
                start_date = self.parse_date(row.get('Start'))
                finish_date = self.parse_date(row.get('Finish'))

                # Get duration
                duration = row.get('Remaining Duration')
                if pd.isna(duration):
                    duration = None
                else:
                    try:
                        duration = int(float(duration))
                    except:
                        duration = None

                # Determine if milestone
                is_milestone = (duration == 0) if duration is not None else False

                # Categorize activity
                activity_name = row.get('Activity Name')
                category = self.categorize_activity(activity_name)

                # Determine activity type
                activity_type = None
                if activity_name and not pd.isna(activity_name):
                    name_lower = str(activity_name).lower()
                    if 'design' in name_lower or 'engineering' in name_lower:
                        activity_type = 'Design'
                    elif 'procure' in name_lower or 'purchase' in name_lower:
                        activity_type = 'Procurement'
                    elif 'fabricat' in name_lower or 'manufactur' in name_lower:
                        activity_type = 'Fabrication'
                    elif 'ship' in name_lower or 'transport' in name_lower:
                        activity_type = 'Transportation'
                    elif 'install' in name_lower or 'erection' in name_lower:
                        activity_type = 'Installation'
                    elif 'test' in name_lower or 'commission' in name_lower:
                        activity_type = 'Testing'
                    elif 'startup' in name_lower or 'first fire' in name_lower:
                        activity_type = 'Startup'

                # Determine status based on dates
                status = 'Not Started'
                if start_date:
                    start_dt = pd.to_datetime(start_date)
                    if start_dt <= pd.Timestamp.now():
                        status = 'In Progress'
                if finish_date:
                    finish_dt = pd.to_datetime(finish_date)
                    if finish_dt <= pd.Timestamp.now():
                        status = 'Complete'

                record = {
                    'activity_id': str(row.get('Activity ID')) if not pd.isna(row.get('Activity ID')) else None,
                    'activity_name': str(activity_name) if not pd.isna(activity_name) else None,
                    'remaining_duration': duration,
                    'start_date': start_date,
                    'finish_date': finish_date,
                    'is_milestone': is_milestone,
                    'activity_type': activity_type,
                    'category': category,
                    'status': status,
                    'percent_complete': 100 if status == 'Complete' else (50 if status == 'In Progress' else 0),
                    'is_critical': False,  # Can be updated manually or through logic
                    'synced_at': datetime.now().isoformat()
                }

                records.append(record)

            print(f"   Prepared {len(records)} records for upload")

            # Upload to Supabase
            print("\n2. Uploading to Supabase...")

            # Clear existing data
            delete_url = f"{self.supabase_url}/rest/v1/project_schedule"
            delete_headers = {
                'apikey': self.supabase_key,
                'Authorization': f'Bearer {self.supabase_key}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }

            # Delete all records
            delete_response = requests.delete(
                f"{delete_url}?id=gte.0",
                headers=delete_headers
            )

            if delete_response.status_code in [200, 204]:
                print("   Cleared old data")
            else:
                print(f"   Warning: Could not clear old data (status: {delete_response.status_code})")

            # Insert new records in batches
            insert_url = f"{self.supabase_url}/rest/v1/project_schedule"
            insert_headers = {
                'apikey': self.supabase_key,
                'Authorization': f'Bearer {self.supabase_key}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }

            batch_size = 100
            total_inserted = 0

            for i in range(0, len(records), batch_size):
                batch = records[i:i+batch_size]

                response = requests.post(
                    insert_url,
                    headers=insert_headers,
                    json=batch
                )

                if response.status_code in [200, 201]:
                    total_inserted += len(batch)
                    print(f"   Inserted batch {i//batch_size + 1}: {total_inserted}/{len(records)} records")
                else:
                    print(f"   Error inserting batch {i//batch_size + 1}: {response.status_code}")
                    print(f"   Response: {response.text}")
                    raise Exception(f"Failed to insert batch")

            print(f"   Successfully synced {total_inserted} schedule activities")

            # Print summary
            print("\n" + "="*80)
            print("SYNC COMPLETED SUCCESSFULLY")
            print("="*80)
            print(f"Total activities synced: {total_inserted}")
            milestones = sum(1 for r in records if r['is_milestone'])
            print(f"Milestones: {milestones}")
            print(f"Work activities: {total_inserted - milestones}")
            print("="*80)

        except Exception as e:
            print(f"\n❌ Error: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)

if __name__ == '__main__':
    syncer = ProjectScheduleSync()
    syncer.sync_schedule()
