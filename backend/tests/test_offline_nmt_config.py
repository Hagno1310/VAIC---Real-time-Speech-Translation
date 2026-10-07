from app.core.config import Settings


def test_offline_nmt_defaults():
    # _env_file=None tests the class defaults independent of any local .env
    # (a local .env may set OFFLINE_NMT_MODEL_DIR= which reads back as "").
    s = Settings(_env_file=None)
    assert s.offline_nmt_model_dir is None
    assert s.offline_nmt_beam_final == 4
    assert s.offline_nmt_intra_threads == 0
