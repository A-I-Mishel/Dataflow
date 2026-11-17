"""FILE: backend/transforms/__init__.py
PURPOSE: Package marker for the per-op transform modules.
HOW IT FITS: engine.py and generator.py import each apply_* directly from its
own module (e.g. "from transforms.drop_na import apply_drop_na"); there is
deliberately no re-export hub here.
WHERE TO EDIT: Nothing. To add an op: create transforms/<op>.py with
apply_<op>, then register it in engine.py, generator.py, and the OpId
Literal in models.py.
"""
