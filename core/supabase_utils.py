"""
Supabase Utilities
Provides shared functions for interacting with Supabase REST API.
"""

import requests
from typing import Dict, List, Optional, Any
from .config import SUPABASE_URL, SUPABASE_KEY, BATCH_SIZE


def get_supabase_headers(prefer: str = 'return=representation') -> Dict[str, str]:
    """
    Get standard Supabase REST API headers.

    Args:
        prefer: Supabase Prefer header value (default: 'return=representation')

    Returns:
        Dictionary of HTTP headers
    """
    return {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': prefer
    }


def supabase_select(
    table: str,
    columns: str = '*',
    filters: Optional[Dict[str, Any]] = None,
    order_by: Optional[str] = None,
    limit: Optional[int] = None
) -> List[Dict]:
    """
    Select records from a Supabase table.

    Args:
        table: Table name
        columns: Columns to select (default: '*')
        filters: Optional dict of column=value filters
        order_by: Optional column to order by
        limit: Optional limit on number of records

    Returns:
        List of records
    """
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={columns}"

    if filters:
        for key, value in filters.items():
            url += f"&{key}=eq.{value}"

    if order_by:
        url += f"&order={order_by}"

    if limit:
        url += f"&limit={limit}"

    headers = get_supabase_headers()
    response = requests.get(url, headers=headers)

    if response.status_code != 200:
        raise Exception(f"Select failed: {response.status_code} - {response.text}")

    return response.json()


def supabase_delete(table: str, filter_column: Optional[str] = None, filter_value: Optional[Any] = None) -> int:
    """
    Delete records from a Supabase table.

    Args:
        table: Table name
        filter_column: Optional column to filter on
        filter_value: Optional value to filter by

    Returns:
        Number of records deleted (approximate)
    """
    url = f"{SUPABASE_URL}/rest/v1/{table}"

    if filter_column and filter_value is not None:
        url += f"?{filter_column}=eq.{filter_value}"
    else:
        # Delete all - need a filter that matches everything
        url += "?id=gt.0"  # Assumes id column exists

    headers = get_supabase_headers('return=minimal')
    response = requests.delete(url, headers=headers)

    if response.status_code not in [200, 204]:
        raise Exception(f"Delete failed: {response.status_code} - {response.text}")

    return 1  # Return count not available with minimal return


def supabase_delete_all(table: str) -> bool:
    """
    Delete all records from a Supabase table.
    Uses a query that matches all records.

    Args:
        table: Table name

    Returns:
        True if successful
    """
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=gt.0"
    headers = get_supabase_headers('return=minimal')

    response = requests.delete(url, headers=headers)

    if response.status_code not in [200, 204]:
        # Try alternative approach - delete without filter (if RLS allows)
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        response = requests.delete(url, headers=headers)

    return response.status_code in [200, 204]


def supabase_insert(table: str, record: Dict[str, Any]) -> Dict:
    """
    Insert a single record into a Supabase table.

    Args:
        table: Table name
        record: Record to insert

    Returns:
        Inserted record
    """
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = get_supabase_headers()

    response = requests.post(url, headers=headers, json=record)

    if response.status_code not in [200, 201]:
        raise Exception(f"Insert failed: {response.status_code} - {response.text}")

    result = response.json()
    return result[0] if isinstance(result, list) else result


def supabase_upsert(table: str, record: Dict[str, Any]) -> Dict:
    """
    Upsert (insert or update) a single record.

    Args:
        table: Table name
        record: Record to upsert (must include primary key)

    Returns:
        Upserted record
    """
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = get_supabase_headers('resolution=merge-duplicates,return=representation')

    response = requests.post(url, headers=headers, json=record)

    if response.status_code not in [200, 201]:
        raise Exception(f"Upsert failed: {response.status_code} - {response.text}")

    result = response.json()
    return result[0] if isinstance(result, list) else result


def supabase_batch_insert(
    table: str,
    records: List[Dict[str, Any]],
    batch_size: int = BATCH_SIZE,
    on_progress: Optional[callable] = None
) -> int:
    """
    Insert records in batches.

    Args:
        table: Table name
        records: List of records to insert
        batch_size: Number of records per batch
        on_progress: Optional callback(batch_num, total_batches)

    Returns:
        Total number of records inserted
    """
    if not records:
        return 0

    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = get_supabase_headers('return=minimal')

    total_inserted = 0
    total_batches = (len(records) + batch_size - 1) // batch_size

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        batch_num = (i // batch_size) + 1

        response = requests.post(url, headers=headers, json=batch)

        if response.status_code not in [200, 201]:
            raise Exception(f"Batch insert failed at batch {batch_num}: {response.status_code} - {response.text}")

        total_inserted += len(batch)

        if on_progress:
            on_progress(batch_num, total_batches)

    return total_inserted


def supabase_batch_upsert(
    table: str,
    records: List[Dict[str, Any]],
    batch_size: int = BATCH_SIZE,
    on_progress: Optional[callable] = None
) -> int:
    """
    Upsert records in batches.

    Args:
        table: Table name
        records: List of records to upsert
        batch_size: Number of records per batch
        on_progress: Optional callback(batch_num, total_batches)

    Returns:
        Total number of records upserted
    """
    if not records:
        return 0

    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = get_supabase_headers('resolution=merge-duplicates,return=minimal')

    total_upserted = 0
    total_batches = (len(records) + batch_size - 1) // batch_size

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        batch_num = (i // batch_size) + 1

        response = requests.post(url, headers=headers, json=batch)

        if response.status_code not in [200, 201]:
            raise Exception(f"Batch upsert failed at batch {batch_num}: {response.status_code} - {response.text}")

        total_upserted += len(batch)

        if on_progress:
            on_progress(batch_num, total_batches)

    return total_upserted


def clear_and_insert(table: str, records: List[Dict[str, Any]], batch_size: int = BATCH_SIZE) -> int:
    """
    Clear a table and insert new records.
    Common pattern for sync operations.

    Args:
        table: Table name
        records: Records to insert
        batch_size: Number of records per batch

    Returns:
        Number of records inserted
    """
    # Clear existing records
    supabase_delete_all(table)

    # Insert new records
    return supabase_batch_insert(table, records, batch_size)
