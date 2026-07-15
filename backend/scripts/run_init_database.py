import traceback
import sys

sys.path.insert(0, '.')

from utils.database import init_database

try:
    init_database()
    print('init_database completed')
except Exception as e:
    print('init_database raised:')
    traceback.print_exc()
