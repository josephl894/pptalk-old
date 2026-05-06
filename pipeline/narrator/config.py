from pathlib import Path
import os
from dotenv import load_dotenv

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PIPELINE_ROOT / ".env")


class Settings:
    @property
    def anthropic_api_key(self) -> str:
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set in pipeline/.env")
        return key

    @property
    def openai_api_key(self) -> str:
        key = os.environ.get("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY is not set in pipeline/.env")
        return key

    @property
    def database_url(self) -> str:
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL is not set in pipeline/.env")
        return url

    @property
    def supabase_url(self) -> str:
        url = os.environ.get("SUPABASE_URL")
        if not url:
            raise RuntimeError("SUPABASE_URL is not set in pipeline/.env")
        return url

    @property
    def supabase_service_role_key(self) -> str:
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not set in pipeline/.env")
        return key


settings = Settings()
