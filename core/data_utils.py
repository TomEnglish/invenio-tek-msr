"""
Data Utilities
Provides shared functions for data cleaning, parsing, and transformation.
"""

import pandas as pd
from datetime import datetime
from typing import Optional, Tuple, Any, Union
from .config import ACTIVITY_CATEGORIES, CATEGORY_NAMES


def clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """
    Clean a DataFrame by replacing NaN, inf, -inf with None.

    Args:
        df: Input DataFrame

    Returns:
        Cleaned DataFrame
    """
    df = df.replace([float('nan'), float('inf'), float('-inf')], None)
    df = df.where(pd.notnull(df), None)
    return df


def parse_date(value: Any, handle_ranges: bool = False) -> Union[str, Tuple[str, str], None]:
    """
    Parse a date value from various formats to ISO format string.

    Args:
        value: Date value (string, datetime, timestamp, etc.)
        handle_ranges: If True, return tuple for date ranges

    Returns:
        ISO format date string, tuple of (start, end) if handle_ranges, or None
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return (None, None) if handle_ranges else None

    # Handle pandas Timestamp or datetime
    if isinstance(value, (pd.Timestamp, datetime)):
        result = value.strftime('%Y-%m-%d')
        return (result, result) if handle_ranges else result

    # Convert to string and clean
    date_str = str(value).strip()
    if not date_str or date_str.lower() in ['nan', 'nat', 'none', '']:
        return (None, None) if handle_ranges else None

    # Check for date range (e.g., "Jan 15 - Feb 20")
    if handle_ranges and ' - ' in date_str:
        parts = date_str.split(' - ')
        if len(parts) == 2:
            start = _parse_single_date(parts[0].strip())
            end = _parse_single_date(parts[1].strip())
            return (start, end)

    # Parse single date
    result = _parse_single_date(date_str)
    return (result, result) if handle_ranges else result


def _parse_single_date(date_str: str) -> Optional[str]:
    """
    Parse a single date string to ISO format.

    Args:
        date_str: Date string

    Returns:
        ISO format date string or None
    """
    if not date_str:
        return None

    # Try common date formats
    formats = [
        '%Y-%m-%d',           # ISO format
        '%m/%d/%Y',           # US format
        '%m/%d/%y',           # US short year
        '%d/%m/%Y',           # European format
        '%B %d, %Y',          # Full month name
        '%b %d, %Y',          # Abbreviated month
        '%b %d',              # Month day only (assume current year)
        '%Y-%m-%dT%H:%M:%S',  # ISO with time
        '%Y-%m-%d %H:%M:%S',  # Date with time
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            # If no year in format, use current year
            if '%Y' not in fmt and '%y' not in fmt:
                dt = dt.replace(year=datetime.now().year)
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            continue

    # Try pandas date parser as fallback
    try:
        dt = pd.to_datetime(date_str)
        if pd.notna(dt):
            return dt.strftime('%Y-%m-%d')
    except:
        pass

    return None


def to_safe_numeric(value: Any, default: Any = None) -> Any:
    """
    Safely convert a value to numeric, handling NaN and errors.

    Args:
        value: Value to convert
        default: Default value if conversion fails

    Returns:
        Numeric value or default
    """
    if value is None:
        return default

    if isinstance(value, (int, float)):
        if pd.isna(value):
            return default
        return value

    try:
        result = pd.to_numeric(value, errors='coerce')
        if pd.isna(result):
            return default
        return result
    except:
        return default


def to_safe_int(value: Any, default: int = 0) -> int:
    """
    Safely convert a value to integer.

    Args:
        value: Value to convert
        default: Default value if conversion fails

    Returns:
        Integer value or default
    """
    result = to_safe_numeric(value, default)
    if result is None:
        return default
    return int(result)


def to_safe_float(value: Any, default: float = 0.0) -> float:
    """
    Safely convert a value to float.

    Args:
        value: Value to convert
        default: Default value if conversion fails

    Returns:
        Float value or default
    """
    result = to_safe_numeric(value, default)
    if result is None:
        return default
    return float(result)


def categorize_activity(activity_name: str) -> str:
    """
    Categorize an activity based on its name using keyword matching.

    Args:
        activity_name: Activity name to categorize

    Returns:
        Category name (e.g., 'Design/Engineering', 'Procurement', etc.)
    """
    if not activity_name:
        return 'Other'

    name_lower = activity_name.lower()

    # Check each category's keywords
    for category_key, keywords in ACTIVITY_CATEGORIES.items():
        for keyword in keywords:
            if keyword in name_lower:
                return CATEGORY_NAMES.get(category_key, 'Other')

    return 'Other'


def is_milestone(activity_name: str, duration: Any = None) -> bool:
    """
    Determine if an activity is a milestone.

    Args:
        activity_name: Activity name
        duration: Activity duration (milestones typically have 0 duration)

    Returns:
        True if activity appears to be a milestone
    """
    if not activity_name:
        return False

    # Check for milestone keywords
    milestone_keywords = [
        'milestone', 'complete', 'approval', 'ready',
        'ifc', 'ifr', 'issue for', 'deliver', 'ship',
        'handover', 'turnover', 'start-up', 'first fire'
    ]

    name_lower = activity_name.lower()
    has_keyword = any(kw in name_lower for kw in milestone_keywords)

    # Check duration (0 or very short typically indicates milestone)
    if duration is not None:
        try:
            dur = float(duration)
            if dur == 0:
                return True
        except:
            pass

    return has_keyword


def calculate_status(start_date: str, finish_date: str, percent_complete: float = 0) -> str:
    """
    Calculate activity status based on dates and completion.

    Args:
        start_date: Start date (ISO format)
        finish_date: Finish date (ISO format)
        percent_complete: Completion percentage (0-100)

    Returns:
        Status string ('Complete', 'In Progress', 'Not Started', 'Overdue')
    """
    if percent_complete >= 100:
        return 'Complete'

    today = datetime.now().date()

    try:
        start = datetime.strptime(start_date, '%Y-%m-%d').date() if start_date else None
        finish = datetime.strptime(finish_date, '%Y-%m-%d').date() if finish_date else None
    except:
        return 'Unknown'

    if finish and finish < today and percent_complete < 100:
        return 'Overdue'

    if start and start <= today:
        return 'In Progress'

    return 'Not Started'


def print_section_header(title: str, width: int = 80):
    """
    Print a formatted section header.

    Args:
        title: Section title
        width: Total width of the header line
    """
    print("\n" + "=" * width)
    print(title)
    print("=" * width)


def print_sync_summary(stats: dict):
    """
    Print a sync operation summary.

    Args:
        stats: Dictionary of statistics to print
    """
    print("\n" + "=" * 80)
    print("Sync Summary")
    print("=" * 80)
    for key, value in stats.items():
        label = key.replace('_', ' ').title()
        print(f"{label}: {value}")
    print("=" * 80)
