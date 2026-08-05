# 🌿 CRC Comercial Insumos — Hub de Agentes de IA

Hub oficial de Inteligência Artificial da **Cooxupé - Comercial Insumos**. Esta plataforma conecta cooperados e equipe comercial aos assistentes inteligentes de IA via WhatsApp, oferecendo suporte 24/7 e um painel de analytics em tempo real para acompanhamento da satisfação e demandas recorrentes.

---

## 🚀 Funcionalidades

- **🤖 Catálogo de Agentes de IA**:
  - **Assistente Salesforce**: Suporte especializado em navegação, criação de oportunidades, relatórios e dashboards.
  - Agentes em breve: Demantra (Planejamento), Campanhas (Marketing) e Negócios (Estratégia).
  - Conexão direta e instantânea com atendimento via WhatsApp.

- **📊 Analytics & Métricas em Tempo Real**:
  - **Filtros por Período**: Visualização por *Hoje*, *Últimos 7 Dias*, *Últimos 30 Dias* ou *Total Geral*.
  - **Conversas por Período**: Métricas de interações com os agentes.
  - **Distribuição de Avaliações**: Gráfico de notas de 1 a 5 estrelas atribuídas pelos cooperados.
  - **Taxa de Resolução Inteligente**: Classificação combinada baseada nas estrelas e no processamento dos comentários (palavras-chave de resolução/insatisfação).
  - **Tópicos Frequentes Dinâmicos**: Mapeamento automático dos assuntos mais consultados com base nos feedbacks recebidos.

- **💬 Feedbacks & Avaliações**:
  - Formulário para envio de notas, seleção do agente e categorização do assunto.
  - Exibição transparente dos últimos feedbacks deixados pelos usuários.

- **🔥 Persistência de Dados via Firebase**:
  - Sincronização centralizada na nuvem com **Firebase Firestore**.
  - Suporte a fallback automático offline (`localStorage`) caso o serviço esteja temporariamente indisponível.

---

## 🛠️ Tecnologias Utilizadas

- **Frontend**: HTML5, TypeScript, Vanilla CSS (Design System responsivo e moderno).
- **Bundler & Dev Server**: [Vite](https://vitejs.dev/)
- **Banco de Dados & Backend**: [Firebase Firestore](https://firebase.google.com/docs/firestore)
- **Containerização**: Docker (Multi-stage build) & Nginx Alpine
- **Hospedagem & CI/CD**: EasyPanel (Hostinger VPS)

---

## 📋 Pré-requisitos & Dependências

### Ambientes e Ferramentas
- **Node.js**: `v20.x` ou superior
- **npm**: `v10.x` ou superior
- **Docker**: (para deploy via container)

### Dependências do Projeto (`package.json`)

#### Dependências de Produção
- `firebase`: `^12.1.0` (SDK do Firebase Firestore e App)

#### Dependências de Desenvolvimento
- `vite`: `^8.2.0` (Build tool e servidor de desenvolvimento)
- `typescript`: `~6.0.2` (Compilador TypeScript)

---

## 💻 Como Rodar Localmente

1. **Clonar o repositório**:
   ```bash
   git clone https://github.com/JDSN6331/CRC-Comercial-Insumos.git
   cd CRC-Comercial-Insumos
   ```

2. **Instalar as dependências**:
   ```bash
   npm install
   ```

3. **Iniciar o servidor de desenvolvimento**:
   ```bash
   npm run dev
   ```
   Acesse a aplicação em `http://localhost:5173`.

4. **Gerar a versão de produção (Build)**:
   ```bash
   npm run build
   ```

---

## 🐳 Executando com Docker

Para rodar a aplicação através de um container Docker localmente:

```bash
# Construir a imagem Docker
docker build -t crc-comercial-insumos .

# Executar o container na porta 8080
docker run -d -p 8080:80 crc-comercial-insumos
```
Acesse a aplicação em `http://localhost:8080`.

---

## 🚀 Deploy no EasyPanel (Hostinger VPS)

A aplicação está configurada para deploy automático no **EasyPanel**:

1. Toda alteração enviada (`git push`) para a branch `main` do GitHub dispara a compilação automática no EasyPanel.
2. O Dockerfile realiza o build otimizado da aplicação e serve os arquivos estáticos via **Nginx Alpine**.

---

## 📑 Licença e Propriedade

Desenvolvido para **Cooxupé — Comercial Insumos**. Todos os direitos reservados.
