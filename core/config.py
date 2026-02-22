"""
Centralized Configuration
Loads environment variables and provides configuration constants for all sync scripts.
"""

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# =============================================================================
# SUPABASE CONFIGURATION
# =============================================================================
SUPABASE_URL = os.getenv('SUPABASE_URL') or 'https://lmdomalnuzbvxxutpyky.supabase.co'
SUPABASE_KEY = os.getenv('SUPABASE_ANON_KEY') or os.getenv('supabase anon public')

# Validate Supabase configuration
if not SUPABASE_KEY:
    raise ValueError("SUPABASE_ANON_KEY not found in environment variables")

# =============================================================================
# SAMSARA CONFIGURATION
# =============================================================================
SAMSARA_API_TOKEN = os.getenv('SAMSARA_API_TOKEN') or os.getenv('Samsara API Token')

# =============================================================================
# SITE CONFIGURATION (Frame 6B Power Group, Amarillo TX)
# =============================================================================
SITE_LATITUDE = 35.293
SITE_LONGITUDE = -101.603
SITE_RADIUS_KM = 0.5  # 500m geofence radius

# =============================================================================
# FILE PATHS
# =============================================================================
PO_SHIPMENT_FILE = 'PO & Shipment Log.xlsx'
SCHEDULE_FILE = 'P0203-PM-120-SCH-0002.xlsx'
DELIVERY_FILE = 'ReadyByDates.xlsx'

# =============================================================================
# SYNC SETTINGS
# =============================================================================
BATCH_SIZE = 100  # Records per batch for Supabase uploads
SAMSARA_HOURS_BACK = 24  # Default hours to look back for Samsara location data

# =============================================================================
# ACTIVITY CATEGORIES
# =============================================================================
ACTIVITY_CATEGORIES = {
    'design': ['design', 'engineering', 'drawing', 'spec', 'calculation', 'review'],
    'procurement': ['procure', 'purchase', 'order', 'vendor', 'supplier', 'rfq', 'po'],
    'fabrication': ['fabricat', 'manufactur', 'build', 'construct', 'weld', 'assembly'],
    'transportation': ['transport', 'ship', 'deliver', 'freight', 'haul', 'truck', 'barge'],
    'installation': ['install', 'erect', 'set', 'place', 'mount', 'connect'],
    'testing': ['test', 'commission', 'inspect', 'check', 'verify', 'calibrat'],
    'startup': ['startup', 'start-up', 'energiz', 'first fire', 'synchron']
}

# Category display names
CATEGORY_NAMES = {
    'design': 'Design/Engineering',
    'procurement': 'Procurement',
    'fabrication': 'Fabrication',
    'transportation': 'Transportation',
    'installation': 'Installation',
    'testing': 'Testing/Commissioning',
    'startup': 'Startup'
}
