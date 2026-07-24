# Provider icons (drop-in)

Кидай сюда SVG — вкладка Providers подхватит их автоматически (glob-импорт в
ProvidersTab.tsx), без правок кода. Имя файла = id глифа, всё в нижнем
регистре:

| Файл             | Провайдер            |
| ---------------- | -------------------- |
| `anthropic.svg`  | Anthropic / Claude   |
| `openai.svg`     | OpenAI               |
| `google.svg`     | Google / Gemini      |
| `azure.svg`      | Azure AI / Foundry   |
| `xai.svg`        | xAI / Grok           |
| `openrouter.svg` | OpenRouter           |
| `groq.svg`       | Groq                 |
| `mistral.svg`    | Mistral              |
| `deepseek.svg`   | DeepSeek             |
| `ollama.svg`     | Ollama               |
| `lmstudio.svg`   | LM Studio            |
| `generic.svg`    | фолбэк для остальных |

Советы:
- квадратный viewBox (например `0 0 24 24`), без фиксированных width/height —
  размер задаётся снаружи;
- одноцветные логотипы лучше с `fill="currentColor"` — тогда они красятся в
  цвет темы; фирменные многоцветные можно оставлять как есть;
- пока файла нет, используется встроенный фолбэк (иконка бренда или монограмма).
