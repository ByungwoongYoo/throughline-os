from .runner import REGISTRY, Worker

# Importing the package registers its handlers. Without this, anything that
# imports the worker without going through main() sees an empty registry and
# every run fails as "no handler registered".
from . import handlers  # noqa: E402,F401

__all__ = ["REGISTRY", "Worker", "handlers"]
