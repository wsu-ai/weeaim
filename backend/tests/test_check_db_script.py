from scripts.check_db import url_problems

GOOD = "postgresql+asyncpg://postgres.abcref:Secret123@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?ssl=require"


def test_a_correct_supabase_session_pooler_url_has_no_problems():
    url, problems = url_problems(GOOD)
    assert url is not None
    assert problems == []


def test_the_masked_url_never_contains_the_password():
    url, _ = url_problems(GOOD)
    assert "Secret123" not in url.render_as_string(hide_password=True)


def test_common_mistakes_are_explained():
    cases = {
        GOOD.replace("postgresql+asyncpg", "postgresql"): "postgresql+asyncpg://",
        GOOD.replace("Secret123", "[YOUR-PASSWORD]"): "placeholder",
        GOOD.replace("aws-0-ap-northeast-2.pooler.supabase.com", "db.abcref.supabase.co"): "direct connection",
        GOOD.replace(":5432", ":6543"): "transaction pooler",
        GOOD.replace("postgres.abcref", "postgres"): "project ref",
        GOOD.replace("?ssl=require", ""): "ssl=require",
        GOOD.replace("Secret123", "Se@cret"): "URL-encoded",
    }
    for raw, expected in cases.items():
        _, problems = url_problems(raw)
        assert any(expected in problem for problem in problems), (raw, problems)


def test_an_empty_value_is_reported():
    url, problems = url_problems("")
    assert url is None
    assert problems == ["The value is empty."]
