"""
Sync PO & Shipment Data from Excel to Supabase
Reads "PO & Shipment Log.xlsx" and uploads to Supabase for auto-updating dashboard
"""
import os
import sys
import pandas as pd
import requests
from dotenv import load_dotenv
from datetime import datetime

# Load environment variables
load_dotenv()

# Configuration
EXCEL_FILE = r"c:\Users\thomasenglish\Desktop\ProjectProgressandPO\PO & Shipment Log.xlsx"
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_ANON_KEY')

class POShipmentSyncService:
    def __init__(self):
        self.supabase_url = SUPABASE_URL
        self.supabase_key = SUPABASE_KEY
        self.supabase_headers = {
            'apikey': self.supabase_key,
            'Authorization': f'Bearer {self.supabase_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }

        if not self.supabase_url or not self.supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env file")

    def clean_dataframe(self, df):
        """Convert DataFrame to JSON-serializable format"""
        # Convert dates
        for col in df.columns:
            if df[col].dtype == 'datetime64[ns]':
                df[col] = df[col].dt.strftime('%Y-%m-%d')
            elif pd.api.types.is_datetime64_any_dtype(df[col]):
                df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%Y-%m-%d')

        # Replace NaN, inf, -inf with None
        df = df.replace([float('nan'), float('inf'), float('-inf')], None)
        df = df.where(pd.notnull(df), None)

        return df

    def sync_purchase_orders(self):
        """Sync PO data from Excel to Supabase"""
        print("\n1. Syncing Purchase Orders...")

        try:
            # Read PO data from Excel
            print("   Reading PO data from Excel...")
            po_df = pd.read_excel(EXCEL_FILE, sheet_name="PO Parts Log")

            # Clean column names (remove spaces, special chars)
            po_df.columns = po_df.columns.str.strip()

            # Clean data
            po_df = self.clean_dataframe(po_df)

            # Helper function to convert to numeric or None
            def to_numeric(value):
                if value is None or pd.isna(value):
                    return None
                try:
                    return float(value)
                except (ValueError, TypeError):
                    return None

            # Map Excel columns to database columns
            po_records = []
            for _, row in po_df.iterrows():
                record = {
                    'purchase_order_id': row.get('Purchase Order ID'),
                    'po_description': row.get('PO Description'),
                    'purchase_order_item': row.get('Purchase Order Item'),
                    'item_uuid': row.get('Item UUID'),
                    'created_on': row.get('Created On'),
                    'item_last_change_date_time': row.get('Item Last Change Date Time'),
                    'delivery_date_from': row.get('Delivery Date From'),
                    'status': row.get('Status'),
                    'item_status': row.get('Item Status'),
                    'delivery_status': row.get('Delivery Status'),
                    'scope': row.get('Scope'),
                    'po_li': row.get('PO LI'),
                    'shipment': row.get('Shipment'),
                    'category': row.get('Category'),
                    'sub_category': row.get('Sub Category'),
                    'project_task': row.get('Project Task'),
                    'supplier': row.get('Supplier'),
                    'item_description': row.get('Item Description'),
                    'item_remark_for_supplier': row.get('Item Remark for Supplier'),
                    'supplier_part_number': row.get('Supplier Part Number'),
                    'product': row.get('Product'),
                    'product_alt': row.get('Product.1'),
                    'manufacturer': row.get('Manufacturer'),
                    'manufacturer_part_number': row.get('Manufacturer Part Number'),
                    'base_uom': row.get('Base UoM'),
                    'item_type': row.get('Item Type'),
                    'ordered_quantity': to_numeric(row.get('Ordered Quantity')),
                    'base_net_price_base_quantity_unit': to_numeric(row.get('Base Net Price Base Quantity Unit')),
                    'net_price': to_numeric(row.get('Net Price')),
                    'net_value': to_numeric(row.get('Net Value')),
                    'incoterms': row.get('Incoterms'),
                    'synced_at': datetime.utcnow().isoformat()
                }
                po_records.append(record)

            print(f"   Uploading {len(po_records)} PO records to Supabase...")

            # Clear all existing data
            print("   Clearing old PO data...")
            delete_url = f"{self.supabase_url}/rest/v1/purchase_orders?id=gte.0"
            delete_response = requests.delete(
                delete_url,
                headers={**self.supabase_headers, 'Prefer': 'return=minimal'}
            )

            if delete_response.status_code not in [200, 204]:
                print(f"   Warning: Could not clear old PO data: {delete_response.status_code} - {delete_response.text}")

            # Insert new data in batches
            batch_size = 100
            inserted = 0

            for i in range(0, len(po_records), batch_size):
                batch = po_records[i:i+batch_size]

                insert_url = f"{self.supabase_url}/rest/v1/purchase_orders"
                insert_response = requests.post(
                    insert_url,
                    headers=self.supabase_headers,
                    json=batch
                )

                if insert_response.status_code in [200, 201]:
                    inserted += len(batch)
                    print(f"   Inserted batch {i//batch_size + 1}: {inserted}/{len(po_records)} records")
                else:
                    print(f"   Error inserting batch: {insert_response.text}")
                    return {'success': False, 'error': insert_response.text}

            print(f"   Successfully synced {inserted} PO records")
            return {'success': True, 'count': inserted}

        except Exception as e:
            print(f"   Error syncing PO data: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'error': str(e)}

    def sync_shipments(self):
        """Sync shipment data from Excel to Supabase"""
        print("\n2. Syncing Shipments...")

        try:
            # Read shipment data from Excel
            print("   Reading shipment data from Excel...")
            ship_df = pd.read_excel(EXCEL_FILE, sheet_name="Shipment Log")

            # Clean column names
            ship_df.columns = ship_df.columns.str.strip()

            # Remove duplicate shipment numbers (keep last occurrence)
            ship_df = ship_df.drop_duplicates(subset=['Shipment #'], keep='last')

            # Clean data
            ship_df = self.clean_dataframe(ship_df)

            # Rename columns to match database schema
            ship_df = ship_df.rename(columns={
                'Shipment #': 'shipment_number',
                'PROJECT': 'project',
                'PO#': 'po_number',
                'RTS Date': 'rts_date',
                'ETA': 'eta',
                'Delivery Date': 'delivery_date',
                'Delivery Time': 'delivery_time',
                'Status': 'status',
                'Category': 'category',
                'Supplier': 'supplier',
                'Part Description': 'part_description',
                '# Pcs': 'num_pieces',
                '# Loads': 'num_loads',
                'Truck Type': 'truck_type',
                'Storage Loc': 'storage_location',
                'Ship from': 'ship_from',
                'Ship to': 'ship_to',
                'Shipper': 'shipper',
                'Shipment By (RPS/Supplier)': 'shipment_by',
                'NCR/OSD (X)': 'ncr_osd',
                'Rcvng Pics': 'receiving_pics',
                'det pk list': 'detailed_packing_list',
                'Progress Notes': 'progress_notes',
                'Special Receiving Instructions': 'special_receiving_instructions'
            })

            # Convert NCR/OSD to boolean
            ship_df['ncr_osd'] = ship_df['ncr_osd'].apply(lambda x: True if x == 'X' else False)

            # Add synced_at timestamp
            ship_df['synced_at'] = datetime.utcnow().isoformat()

            # Convert to records (list of dicts)
            ship_records = ship_df.to_dict('records')

            # Ensure all values are JSON-serializable and correct types
            for record in ship_records:
                for key, value in record.items():
                    if pd.isna(value) or value is None:
                        record[key] = None
                    elif isinstance(value, (pd.Timestamp, datetime)):
                        record[key] = value.strftime('%Y-%m-%d') if hasattr(value, 'strftime') else str(value)
                    elif key in ['rts_date', 'eta', 'delivery_date'] and isinstance(value, str):
                        # Handle dates that might have multiple values like "1/7/2026; 1/8/2026"
                        if ';' in value:
                            value = value.split(';')[0].strip()  # Take first date
                        # Ensure it's in proper YYYY-MM-DD format or set to None
                        try:
                            parsed_date = pd.to_datetime(value, errors='coerce')
                            record[key] = parsed_date.strftime('%Y-%m-%d') if not pd.isna(parsed_date) else None
                        except:
                            record[key] = None
                    elif key in ['num_pieces', 'num_loads'] and value is not None:
                        # Convert to int (handle floats like 1.0)
                        try:
                            record[key] = int(float(value))
                        except (ValueError, TypeError):
                            record[key] = None
                    elif isinstance(value, (float, int)) and (pd.isna(value) or value in [float('inf'), float('-inf')]):
                        record[key] = None

            print(f"   Uploading {len(ship_records)} shipment records to Supabase...")

            # Clear existing data
            delete_url = f"{self.supabase_url}/rest/v1/shipments"
            delete_response = requests.delete(
                delete_url,
                headers={**self.supabase_headers, 'Prefer': 'return=minimal'},
                params={'id': 'gt.0'}
            )

            if delete_response.status_code not in [200, 204]:
                print(f"   Warning: Could not clear old shipment data: {delete_response.text}")

            # Insert new data
            insert_url = f"{self.supabase_url}/rest/v1/shipments"
            insert_response = requests.post(
                insert_url,
                headers=self.supabase_headers,
                json=ship_records
            )

            if insert_response.status_code in [200, 201]:
                print(f"   Successfully synced {len(ship_records)} shipment records")
                return {'success': True, 'count': len(ship_records)}
            else:
                print(f"   Error inserting shipments: {insert_response.text}")
                return {'success': False, 'error': insert_response.text}

        except Exception as e:
            print(f"   Error syncing shipment data: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'error': str(e)}

    def refresh_metrics(self):
        """Call Supabase function to refresh dashboard metrics"""
        print("\n3. Refreshing Dashboard Metrics...")

        try:
            # Call the refresh_dashboard_metrics() function
            rpc_url = f"{self.supabase_url}/rest/v1/rpc/refresh_dashboard_metrics"
            response = requests.post(
                rpc_url,
                headers=self.supabase_headers
            )

            if response.status_code in [200, 204]:
                print("   Dashboard metrics refreshed successfully")
                return {'success': True}
            else:
                print(f"   Error refreshing metrics: {response.text}")
                return {'success': False, 'error': response.text}

        except Exception as e:
            print(f"   Error refreshing metrics: {e}")
            return {'success': False, 'error': str(e)}


def main():
    print("=" * 80)
    print("PO & SHIPMENT DATA SYNC")
    print("=" * 80)
    print(f"Excel file: {EXCEL_FILE}")
    print(f"Supabase URL: {SUPABASE_URL}")
    print("=" * 80)

    # Check if Excel file exists
    if not os.path.exists(EXCEL_FILE):
        print(f"\nError: Excel file not found at {EXCEL_FILE}")
        print("Please ensure 'PO & Shipment Log.xlsx' exists in the project folder.")
        sys.exit(1)

    try:
        # Create sync service
        sync_service = POShipmentSyncService()

        # Sync purchase orders
        po_result = sync_service.sync_purchase_orders()
        if not po_result['success']:
            print("\nPO sync failed!")
            sys.exit(1)

        # Sync shipments
        ship_result = sync_service.sync_shipments()
        if not ship_result['success']:
            print("\nShipment sync failed!")
            sys.exit(1)

        # Refresh metrics
        metrics_result = sync_service.refresh_metrics()

        # Print summary
        print("\n" + "=" * 80)
        print("SYNC COMPLETED SUCCESSFULLY")
        print("=" * 80)
        print(f"Purchase Orders synced: {po_result.get('count', 0)}")
        print(f"Shipments synced: {ship_result.get('count', 0)}")
        print(f"Dashboard metrics: {'Refreshed' if metrics_result['success'] else 'Failed'}")
        print("=" * 80)

        sys.exit(0)

    except Exception as e:
        print(f"\nFatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(2)


if __name__ == "__main__":
    main()
