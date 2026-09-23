"""FILE: backend/constants.py
PURPOSE: Shared constants, breaks circular imports.
HOW IT FITS: Imported by models + session_store.
WHERE TO EDIT: Already documented — skip.
"""
"""Shared backend constants.

Lives in its own module so both API models and transform implementations
can import values without creating circular dependencies (transforms import
models, so models must never import from transforms).
"""


ONE_HOT_MAX_CELLS: int = 10_000_000
