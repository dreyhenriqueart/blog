# COMMS — blog terminal

Blog no estilo terminal de comunicações espaciais.

## URLs (após GitHub Pages)

- Site: `https://dreyhenriqueart.github.io/blog/`
- Admin: `https://dreyhenriqueart.github.io/blog/admin.html`
- Edit: `https://dreyhenriqueart.github.io/blog/admin-edit.html`

## Publicar no admin (produção)

1. Crie um **Personal Access Token** (classic) em GitHub → Settings → Developer settings → Personal access tokens
2. Escopo mínimo: **`repo`** (ou fine-grained com Contents: Read and write neste repositório)
3. No admin, ao clicar **publish** / **archive** / **delete**, cole o token quando solicitado (fica salvo no navegador)

O admin grava direto em `posts.json` via GitHub Contents API. Visitantes com o site aberto recebem posts novos pelo polling do `raw.githubusercontent.com`.

## Local

```bat
serve.bat
```

Abre em `http://localhost:8771/` (porta definida em `serve.ps1`).
