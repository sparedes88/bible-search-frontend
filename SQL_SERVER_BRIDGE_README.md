# SQL Server Bridge Setup Guide

## Overview
This bridge allows you to connect your RazorSQL database to your Church Admin application, enabling you to view and query your SQL Server data directly from the web interface.

## Setup Steps

### 1. Configure SQL Server Connection
You need to set up environment variables for your SQL Server connection. You can do this in several ways:

#### Option A: Firebase Environment Variables (Recommended)
Set these in your Firebase project:
```bash
firebase functions:config:set sql.user="your_username"
firebase functions:config:set sql.password="your_password"
firebase functions:config:set sql.server="your_server_address"
firebase functions:config:set sql.port="1433"
firebase functions:config:set sql.database="your_database_name"
```

#### Option B: Local Environment Variables
Create a `.env` file in the `functions` directory:
```env
SQL_USER=your_username
SQL_PASSWORD=your_password
SQL_SERVER=your_server_address
SQL_PORT=1433
SQL_DATABASE=your_database_name
```

### 2. SQL Server Requirements
- Your SQL Server must allow remote connections
- The user must have SELECT permissions on the databases you want to access
- TCP/IP protocol must be enabled in SQL Server Configuration Manager
- Firewall must allow connections on port 1433 (or your configured port)

### 3. Deploy Functions
```bash
cd functions
npm run deploy
```

### 4. Access the Bridge
Navigate to `/sql-server-bridge` in your application (admin access required)

## Features

### Database Overview
- View all tables in your database
- See record counts for each table
- Database connection status

### Table Browser
- Browse any table in your database
- View table schema (columns, data types)
- Paginated data viewing
- Sortable columns

### Custom Queries
- Execute SELECT queries directly
- Safe read-only operations
- JSON-formatted results

## Security Notes

- Only SELECT queries are allowed for safety
- All functions require admin authentication
- Connection details are encrypted in Firebase
- CORS is properly configured for your domain

## Troubleshooting

### Connection Issues
1. Verify SQL Server allows remote connections
2. Check firewall settings
3. Ensure user has proper permissions
4. Verify server address and port

### Authentication Issues
1. Check Firebase function logs: `firebase functions:log`
2. Verify environment variables are set correctly
3. Ensure user has admin role

### Data Display Issues
1. Check table permissions
2. Verify column names don't contain special characters
3. Ensure data types are supported

## Example Usage

Once connected, you can:
- View all your church member data
- Query event attendance records
- Browse financial transaction history
- Analyze visitor demographics
- Generate custom reports

The bridge provides a web interface to your existing SQL Server data without needing to export or migrate anything.
