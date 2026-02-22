"""
Sync Delivery Dates data from Excel to Supabase
Reads ReadyByDates.xlsx and uploads to delivery_dates table
"""

import os
import sys
import pandas as pd
import requests
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class ReadyByDatesSync:
    def __init__(self):
        self.supabase_url = os.getenv('SUPABASE_URL')
        self.supabase_key = os.getenv('SUPABASE_ANON_KEY')
        self.excel_file = 'ReadyByDates.xlsx'

        if not self.supabase_url or not self.supabase_key:
            raise ValueError("Missing Supabase credentials in .env file")

        self.supabase_headers = {
            'apikey': self.supabase_key,
            'Authorization': f'Bearer {self.supabase_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        }

    def clean_dataframe(self, df):
        """Replace NaN, inf values with None"""
        df = df.replace([float('nan'), float('inf'), float('-inf')], None)
        df = df.where(pd.notnull(df), None)
        return df

    def parse_date(self, value):
        """Parse date, handling ranges and various formats"""
        if value is None or pd.isna(value):
            return None, None

        value_str = str(value).strip()

        # Check if it's a date range (contains "-" or "to")
        if ' - ' in value_str or ' to ' in value_str:
            # It's a range, store the full range as notes
            # Try to extract first date
            first_date = value_str.split(' - ')[0].split(' to ')[0].strip()
            try:
                parsed_date = pd.to_datetime(first_date, errors='coerce')
                if not pd.isna(parsed_date):
                    return parsed_date.strftime('%Y-%m-%d'), value_str
            except:
                pass
            return None, value_str

        # Single date
        try:
            parsed_date = pd.to_datetime(value, errors='coerce')
            if not pd.isna(parsed_date):
                return parsed_date.strftime('%Y-%m-%d'), None
        except:
            pass

        return None, value_str

    def sync_ready_dates(self):
        """Sync ready by dates data to Supabase"""
        print("\n" + "="*80)
        print("READY BY DATES SYNC")
        print("="*80)
        print(f"Excel file: {os.path.abspath(self.excel_file)}")
        print(f"Supabase URL: {self.supabase_url}")
        print("="*80)

        try:
            # Read Excel file
            print("\n1. Reading Delivery Dates data from Excel...")
            df = pd.read_excel(self.excel_file)
            print(f"   Found {len(df)} records")

            # Clean data
            df = self.clean_dataframe(df)

            # Map columns
            column_mapping = {
                'Project Phase ': 'project_phase',
                'Package Description': 'package_description',
                'Tag #': 'tag_number',
                'Supplier Name': 'supplier_name',
                'PO #': 'po_number',
                'Ready to Ship Date': 'delivery_date'  # Changed from 'Delivery Date'
            }

            # Prepare records
            print("   Processing records...")
            records = []
            for _, row in df.iterrows():
                record = {}

                for excel_col, db_col in column_mapping.items():
                    value = row.get(excel_col)

                    # Check for NaN/None first
                    if value is None or pd.isna(value):
                        if db_col == 'delivery_date':
                            record['delivery_date'] = None
                            record['delivery_date_notes'] = None
                        else:
                            record[db_col] = None
                        continue

                    if db_col == 'delivery_date':
                        # Parse date
                        date_val, notes = self.parse_date(value)
                        record['delivery_date'] = date_val
                        record['delivery_date_notes'] = notes
                    elif db_col == 'po_number':
                        # Convert PO number to string
                        try:
                            record[db_col] = str(int(float(value)))
                        except (ValueError, TypeError):
                            record[db_col] = str(value)
                    else:
                        # Convert all other values to strings
                        record[db_col] = str(value) if value != '' else None

                # Add sync timestamp
                record['synced_at'] = datetime.now(datetime.UTC).isoformat() if hasattr(datetime, 'UTC') else datetime.utcnow().isoformat()
                records.append(record)

            print(f"   Prepared {len(records)} records for upload")

            # Upload to Supabase
            print("\n2. Uploading to Supabase...")

            # Clear existing data
            delete_url = f"{self.supabase_url}/rest/v1/delivery_dates"
            delete_response = requests.delete(
                delete_url,
                headers={**self.supabase_headers, 'Prefer': 'return=minimal'},
                params={'id': 'gte.0'}
            )

            if delete_response.status_code in [200, 204]:
                print("   Cleared old data")

            # Insert new data in batches
            batch_size = 100
            total_inserted = 0

            for i in range(0, len(records), batch_size):
                batch = records[i:i+batch_size]

                insert_url = f"{self.supabase_url}/rest/v1/delivery_dates"
                insert_response = requests.post(
                    insert_url,
                    headers=self.supabase_headers,
                    json=batch
                )

                if insert_response.status_code in [200, 201]:
                    total_inserted += len(batch)
                    print(f"   Inserted batch {(i//batch_size)+1}: {total_inserted}/{len(records)} records")
                else:
                    print(f"   Error inserting batch: {insert_response.text}")
                    return {'success': False, 'error': insert_response.text}

            print(f"   Successfully synced {total_inserted} ready date records")

            print("\n" + "="*80)
            print("SYNC COMPLETED SUCCESSFULLY")
            print("="*80)
            print(f"Ready date records synced: {total_inserted}")
            print("="*80)

            return {'success': True, 'count': total_inserted}

        except FileNotFoundError:
            print(f"\nError: Excel file '{self.excel_file}' not found!")
            print("Please ensure ReadyByDates.xlsx is in the project directory.")
            return {'success': False, 'error': 'File not found'}
        except Exception as e:
            print(f"\nError syncing ready dates: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'error': str(e)}

def main():
    try:
        sync = ReadyByDatesSync()
        result = sync.sync_ready_dates()

        if not result['success']:
            sys.exit(1)

    except Exception as e:
        print(f"Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
