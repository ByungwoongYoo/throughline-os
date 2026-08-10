"""Controlled vocabularies for the research model.

These enums are the specification's distinctions rendered in code. The system
laws depend on them staying separate: collapsing FindingLifecycle.CANDIDATE into
FindingLifecycle.VALIDATED, or ClaimType.AI_INTERPRETATION into
ClaimType.CALCULATED_RESULT, would silently break the rule and the rule.
"""

from __future__ import annotations

from enum import StrEnum


class ObjectType(StrEnum):
    """ — every addressable thing in a research project."""

    PAPER = "paper"
    DATASET = "dataset"
    DATASET_VARIABLE = "dataset_variable"
    TABLE = "table"
    FIGURE = "figure"
    IMAGE = "image"
    CODE = "code"
    NOTEBOOK = "notebook"
    EXPERIMENT = "experiment"
    AUTHOR = "author"
    INSTITUTION = "institution"
    POPULATION = "population"
    SAMPLE = "sample"
    CONCEPT = "concept"
    METHOD = "method"
    HYPOTHESIS = "hypothesis"
    ANALYSIS = "analysis"
    CLAIM = "claim"
    FINDING = "finding"
    CITATION = "citation"
    INTERVENTION = "intervention"
    OUTCOME = "outcome"
    MODEL = "model"
    GEOGRAPHY = "geography"
    TIME_PERIOD = "time_period"
    RESEARCH_GAP = "research_gap"
    CONTRADICTION = "contradiction"
    VISUALIZATION = "visualization"
    DASHBOARD = "dashboard"
    MANUSCRIPT = "manuscript"
    PRESENTATION = "presentation"
    VIDEO = "video"
    VIDEO_SCENE = "video_scene"


class LineageType(StrEnum):
    """ — how a derived artifact relates to what produced it."""

    DERIVED_FROM = "derived_from"
    TRANSFORMED_FROM = "transformed_from"
    CALCULATED_FROM = "calculated_from"
    SUPPORTS = "supports"
    VISUALIZES = "visualizes"
    COMMUNICATES = "communicates"
    SUMMARIZES = "summarizes"
    REFERENCES = "references"


class FindingLifecycle(StrEnum):
    """ — a pattern is not a finding. Order matters; see FINDING_PROMOTION."""

    CANDIDATE = "candidate"
    EXPLORATORY = "exploratory"
    VALIDATED = "validated"
    REPLICATED = "replicated"
    CONFLICTED = "conflicted"
    DEPRECATED = "deprecated"


#: Legal lifecycle transitions. A candidate may never jump to validated:
#: promotion past EXPLORATORY requires the robustness checks, which are
#: enforced by the domain service rather than by the caller.
FINDING_PROMOTION: dict[FindingLifecycle, set[FindingLifecycle]] = {
    FindingLifecycle.CANDIDATE: {FindingLifecycle.EXPLORATORY, FindingLifecycle.DEPRECATED},
    FindingLifecycle.EXPLORATORY: {
        FindingLifecycle.VALIDATED,
        FindingLifecycle.CONFLICTED,
        FindingLifecycle.DEPRECATED,
        },
    FindingLifecycle.VALIDATED: {
        FindingLifecycle.REPLICATED,
        FindingLifecycle.CONFLICTED,
        FindingLifecycle.DEPRECATED,
        },
    FindingLifecycle.REPLICATED: {FindingLifecycle.CONFLICTED, FindingLifecycle.DEPRECATED},
    FindingLifecycle.CONFLICTED: {
        FindingLifecycle.EXPLORATORY,
        FindingLifecycle.VALIDATED,
        FindingLifecycle.DEPRECATED,
        },
    FindingLifecycle.DEPRECATED: set(),
    }


class ConnectionLifecycle(StrEnum):
    """ — discovered relationships carry the same discipline as findings."""

    CANDIDATE = "candidate"
    EXPLORATORY = "exploratory"
    VALIDATED = "validated"
    REPLICATED = "replicated"
    CONFLICTED = "conflicted"
    REJECTED = "rejected"


class ClaimType(StrEnum):
    """ — never merge these categories.

    The distinction between SOURCE_FACT, CALCULATED_RESULT and AI_INTERPRETATION
    is what makes the rule auditable.
    """

    SOURCE_FACT = "source_fact"
    CALCULATED_RESULT = "calculated_result"
    LITERATURE_INTERPRETATION = "literature_interpretation"
    AI_INTERPRETATION = "ai_interpretation"
    HYPOTHESIS = "hypothesis"
    CAUSAL_CLAIM = "causal_claim"
    RECOMMENDATION = "recommendation"


class ClaimStatus(StrEnum):
    PROPOSED = "proposed"
    SUPPORTED = "supported"
    DISPUTED = "disputed"
    REFUTED = "refuted"
    WITHDRAWN = "withdrawn"


class EvidenceDirection(StrEnum):
    """."""

    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"
    MIXED = "mixed"
    NEUTRAL = "neutral"


class EvidenceType(StrEnum):
    SOURCE_SPAN = "source_span"
    DATASET_VALUE = "dataset_value"
    ANALYSIS_RESULT = "analysis_result"
    FIGURE = "figure"
    TABLE = "table"
    EXTERNAL_REFERENCE = "external_reference"
    HUMAN_ASSERTION = "human_assertion"


class FindingType(StrEnum):
    """."""

    LITERATURE = "literature"
    STATISTICAL = "statistical"
    COMPARISON = "comparison"
    MULTIMODAL = "multimodal"
    TEMPORAL = "temporal"
    GEOGRAPHIC = "geographic"
    NETWORK = "network"
    QUALITATIVE = "qualitative"
    CAUSAL = "causal"
    ANOMALY = "anomaly"


class CausalStatus(StrEnum):
    """/ — association is not causation, and the model says so."""

    NOT_ASSESSED = "not_assessed"
    ASSOCIATION_ONLY = "association_only"
    TEMPORALLY_CONSISTENT = "temporally_consistent"
    POSSIBLE_CAUSAL = "possible_causal"
    CAUSAL_SUPPORTED = "causal_supported"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


class SourceType(StrEnum):
    """."""

    UPLOAD = "upload"
    CONNECTOR = "connector"
    URL = "url"
    MANUAL = "manual"
    DERIVED = "derived"


class IngestionStatus(StrEnum):
    """ — the ingestion state machine. FAILED preserves completed work."""

    UPLOADED = "uploaded"
    VALIDATED = "validated"
    SCANNED = "scanned"
    EXTRACTING = "extracting"
    PARSING = "parsing"
    STRUCTURING = "structuring"
    INDEXING = "indexing"
    ENRICHING = "enriching"
    READY = "ready"
    FAILED = "failed"


#: Forward progression of . A stage may only advance to the next stage or to
#: FAILED; this prevents a retry from silently rewinding published state.
INGESTION_PROGRESSION: list[IngestionStatus] = [
    IngestionStatus.UPLOADED,
    IngestionStatus.VALIDATED,
    IngestionStatus.SCANNED,
    IngestionStatus.EXTRACTING,
    IngestionStatus.PARSING,
    IngestionStatus.STRUCTURING,
    IngestionStatus.INDEXING,
    IngestionStatus.ENRICHING,
    IngestionStatus.READY,
    ]


class WorkflowState(StrEnum):
    """ — must survive a worker restart."""

    QUEUED = "queued"
    RUNNING = "running"
    AWAITING_USER = "awaiting_user"
    AWAITING_APPROVAL = "awaiting_approval"
    RETRYING = "retrying"
    COMPLETED = "completed"
    PARTIALLY_COMPLETED = "partially_completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_WORKFLOW_STATES = {
    WorkflowState.COMPLETED,
    WorkflowState.PARTIALLY_COMPLETED,
    WorkflowState.FAILED,
    WorkflowState.CANCELLED,
    }


class ResearchEdgeType(StrEnum):
    """ — the research graph vocabulary."""

    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"
    CITES = "cites"
    USES = "uses"
    MEASURES = "measures"
    SIMILAR_TO = "similar_to"
    REPLICATES = "replicates"
    EXTENDS = "extends"
    CORRELATES_WITH = "correlates_with"
    ASSOCIATED_WITH = "associated_with"
    MODERATES = "moderates"
    MEDIATES = "mediates"
    DEPENDS_ON = "depends_on"
    DERIVED_FROM = "derived_from"
    STUDIES = "studies"
    BELONGS_TO = "belongs_to"


class TrustLevel(StrEnum):
    """ — the prompt-injection boundary.

    Content carries its trust level with it. UNTRUSTED content may never be
    interpreted as instructions, regardless of what it says about itself.
    """

    RESEARCHER = "researcher"
    SYSTEM = "system"
    COMPUTED = "computed"
    UNTRUSTED = "untrusted"
