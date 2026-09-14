import pytest

from pipeline.candidates import describe_feature


@pytest.mark.parametrize(
    ("name", "value", "expected"),
    [
        ("out_frac_SIP", 0.42, "42% of output synapses in SIP"),
        ("in_degree", 12.0, "12 strong input partner types"),
        ("nt", "gaba", "predicted neurotransmitter gaba"),
        ("community", 2, "member of wiring community 2"),
    ],
)
def test_describe_feature_handles_numeric_and_categorical_values(name, value, expected):
    assert describe_feature(name, value) == expected


def test_describe_feature_rejects_unknown_features():
    with pytest.raises(KeyError):
        describe_feature("unknown", 1)
