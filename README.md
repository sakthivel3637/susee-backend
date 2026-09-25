# DVSOS Backend

Backend foundation for the Digital Vehicle Service Operations System.

## Stack

- Node.js
- Express.js
- Prisma ORM
- Azure SQL Server
- JWT authentication
- Azure Blob Storage

## Setup

```bash
npm install
cp .env
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

On Windows PowerShell, copy the environment file with:

```powershell
Copy-Item .env
```

## Environment

Set `DATABASE_URL`, `JWT_SECRET`, and any optional integration credentials in `.env`.

For Azure SQL, use Prisma's SQL Server URL format, not the Azure Portal ADO.NET format:

```env
DATABASE_URL="sqlserver://dvsos-sql-server.database.windows.net:1433;database=DVSOS;user=your_username;password=your_password;encrypt=true;trustServerCertificate=true"
```

If the username or password contains special characters such as `:`, `=`, `;`, `/`, `[`, `]`, `{`, or `}`, wrap that value in braces:

```env
DATABASE_URL="sqlserver://dvsos-sql-server.database.windows.net:1433;database=DVSOS;user={your_username};password={your_password};encrypt=true;trustServerCertificate=true"
```

The app config also accepts the existing `MSSERVER_URI` key as a runtime fallback for `DATABASE_URL`. Prisma CLI commands should use `DATABASE_URL` in `.env`.

Optional Firebase, Twilio, and Azure settings do not crash the server in development when missing. Missing optional credentials are logged as warnings.

## Health Check

```http
GET /api/health
```

Response shape:

```json
{
  "success": true,
  "message": "DVSOS Backend is healthy",
  "data": {},
  "meta": {}
}
```
