# Assinatura digital do PulseCord (Windows)

Sem assinatura, o Windows mostra **"O Windows protegeu o computador" / "Editor desconhecido"** ao abrir o
`PulseCord-Portable.exe` ou o instalador. Para isso sumir é preciso assinar o .exe com um certificado de
*code signing* emitido por uma autoridade certificadora (CA). **Não existe certificado gratuito para isso**.

O projeto já está pronto: basta ter o certificado e rodar

```powershell
npm run build:signed
```

(`npm run build:signed -- portable` gera só o portátil.) No fim o script mostra `assinatura Valid` para cada .exe.

## Qual certificado comprar (pessoa física no Brasil)

| Opção | Para quem | Observação |
|---|---|---|
| **Certificado OV de code signing** (Certum, Sectigo, SSL.com, DigiCert...) | Pessoa física ou empresa | Desde 2023 a chave fica obrigatoriamente em token USB ou em "nuvem" (ex.: Certum SimplySign). O aviso do SmartScreen vai sumindo conforme o app ganha reputação (downloads). Certum "Open Source Code Signing" é a opção mais barata para projetos abertos. |
| **Certificado EV** | Só empresa (CNPJ) | Mais caro; também em token. |
| **Azure Artifact Signing** (antigo *Trusted Signing*) | Empresas nos EUA, Canadá, UE e Reino Unido; pessoa física só nos EUA e Canadá | Assinatura paga mensal. **Hoje não atende pessoa física no Brasil.** |

Fontes:
- Microsoft — FAQ do Artifact Signing (elegibilidade por país): https://learn.microsoft.com/en-us/azure/artifact-signing/faq
- Microsoft — Quickstart do Artifact Signing: https://learn.microsoft.com/azure/artifact-signing/quickstart
- Microsoft Q&A — Trusted Signing para outros países: https://learn.microsoft.com/en-us/answers/questions/2243504/trusted-signing-for-other-countries
- Página do produto: https://azure.microsoft.com/en-gb/products/artifact-signing

## Como configurar

Antes de rodar, defina **uma** das opções no PowerShell (só vale para aquela janela):

### 1) Token USB ou certificado em nuvem (o caso mais comum hoje)

1. Instale o driver/app do fornecedor (ex.: SimplySign Desktop, SafeNet Authentication Client) e conecte.
2. Instale o **Windows SDK** marcando apenas *Windows SDK Signing Tools for Desktop Apps* (traz o `signtool.exe`).
3. Descubra a impressão digital do certificado:
   ```powershell
   Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Format-List Subject, Thumbprint
   ```
4. Gere:
   ```powershell
   $env:PULSECORD_SIGN_THUMBPRINT = "COLE_A_THUMBPRINT_AQUI"
   ```
   ```powershell
   npm run build:signed
   ```
   O PIN do token é pedido pela janela do próprio fornecedor.

### 2) Arquivo .pfx

```powershell
$env:CSC_LINK = "C:\caminho\certificado.pfx"; $env:CSC_KEY_PASSWORD = "senha-do-pfx"
```

### 3) Azure Artifact Signing (se um dia ficar disponível para você)

```powershell
$env:AZURE_SIGN_ENDPOINT = "https://eus.codesigning.azure.net"; $env:AZURE_SIGN_ACCOUNT = "conta"; $env:AZURE_SIGN_PROFILE = "perfil"; $env:AZURE_SIGN_PUBLISHER = "CN=Seu Nome"
```

e também `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` e `AZURE_CLIENT_SECRET` do *App Registration* com a função
*Artifact Signing Certificate Profile Signer*.

## Detalhes

- Carimbo de tempo (timestamp RFC 3161): `http://time.certum.pl` por padrão. Troque com
  `$env:PULSECORD_SIGN_TIMESTAMP = "http://timestamp.sectigo.com"` (ou o do seu fornecedor). Com carimbo,
  o .exe continua válido depois que o certificado vence.
- Algoritmo: SHA-256.
- Conferir manualmente: `Get-AuthenticodeSignature .\dist\PulseCord-Portable.exe`
- `npm run build:exe` continua gerando a versão **sem** assinatura, como antes.
