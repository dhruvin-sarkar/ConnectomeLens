"""Shared paths, constants, and the neuPrint client factory."""

import os
from pathlib import Path

import requests
from neuprint import Client, set_default_client

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RESULTS = ROOT / "results"
ASSETS = ROOT / "assets"
WEB_DATA = ROOT / "web" / "public" / "data"

NEUPRINT_SERVER = "https://neuprint.janelia.org"
DATASET = "male-cns:v1.0"
SEED = 20260914

# Superclass values (neuPrint `superclass` property) that define graph entry and exit points.
SENSORY_SUPERCLASSES = frozenset(
    {"cb_sensory", "ol_sensory", "vnc_sensory", "sensory_ascending", "sensory_descending"}
)
MOTOR_SUPERCLASSES = frozenset({"descending_neuron", "cb_motor", "vnc_motor"})

# Cell types named in Google's announcements of the male CNS connectome (2026-09-03): AOTU008 in the
# Google Research blog; AOTU012, DNg13 and LoVP92 in the companion post on blog.google.
NAMED_TYPES = ("AOTU008", "AOTU012", "DNg13", "LoVP92")

LABELS_PATH = DATA / "ground_truth_labels.parquet"
NEURONS_PATH = DATA / "neurons.parquet"
NEURON_ROI_PATH = DATA / "neuron_roi_counts.parquet"
TYPE_NODES_PATH = DATA / "type_nodes.parquet"
TYPE_EDGES_PATH = DATA / "type_edges.parquet"
FEATURES_PATH = DATA / "features.parquet"
SCORES_PATH = DATA / "scores.parquet"


def get_client() -> Client:
    """Return a neuPrint client for the male CNS dataset and register it as the default.

    Uses the token in ``NEUPRINT_APPLICATION_CREDENTIALS`` when set. Without a token the
    client makes anonymous requests, which neuprint.janelia.org accepts for public datasets.
    """
    token = os.environ.get("NEUPRINT_APPLICATION_CREDENTIALS")
    if token:
        client = Client(NEUPRINT_SERVER, dataset=DATASET, token=token)
    else:
        resp = requests.get(f"{NEUPRINT_SERVER}/api/dbmeta/datasets", timeout=60)
        resp.raise_for_status()
        Client.DATASETS_CACHE[NEUPRINT_SERVER] = resp.json()
        client = Client(NEUPRINT_SERVER, dataset=DATASET, token="anonymous")
        client.session.headers.pop("Authorization")
    set_default_client(client)
    return client
