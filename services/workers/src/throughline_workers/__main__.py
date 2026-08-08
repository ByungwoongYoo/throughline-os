"""Entry point for `python -m throughline_workers`.

Deliberately not `python -m throughline_workers.runner`: that imports the
package (registering handlers into `runner.REGISTRY`) and then re-executes
`runner` as `__main__`, producing a *second* module object with its own empty
registry. The worker would start and silently handle nothing.
"""

from .runner import main

main()
