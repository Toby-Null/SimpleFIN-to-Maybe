
# SimpleFIN to Maybe

A synchronization tool to connect SimpleFIN accounts with Maybe Finance.

# Features
- SimpleFIN Integration: Connect to your financial institutions through SimpleFIN's secure API
- Maybe Finance Sync: Push account data directly to your Maybe Finance database
- Automatic Syncing: Schedule regular data syncing
- Transaction Rule: Transform your transaction data with custom rules for categorization
- Transaction History: Customize how far back to retrieve transactions
- Web Interface: Easy-to-use dashboard for configuration and monitoring

# Demo

![Maybe Settings](https://raw.githubusercontent.com/Toby-Null/SimpleFIN-to-Maybe/main/demo/Maybe%20Settings.png)
![Simplefin Settings](https://raw.githubusercontent.com/Toby-Null/SimpleFIN-to-Maybe/main/demo/Simplefin%20Settings.png)
![Scheduling Settings](https://raw.githubusercontent.com/Toby-Null/SimpleFIN-to-Maybe/main/demo/Scheduling%20Settings.png)
![Scheduling Settings](https://raw.githubusercontent.com/Toby-Null/SimpleFIN-to-Maybe/main/demo/Budget%20Status.png)

# Installation
Prerequisites
- Node.js (v22 or higher)
- PostgreSQL database
- SimpleFIN account and setup token
- Access to a Maybe Finance database
Setup
1. Clone the repository
```ssh
git clone https://github.com/Toby-Null/Simplefin-to-Maybe.git
cd simplefin-to-maybe
```
2. Install dependencies
```ssh
npm install
```
3. Create a .env file with the following variables:
```env
# Server settings
PORT=3000
NODE_ENV=development

# Database connection
DB_HOST=localhost
DB_PORT=5432
DB_NAME=simplefin_maybe
DB_USER=postgres
DB_PASSWORD=yourpassword

# Session secret
SESSION_SECRET=your_session_secret_key
```
4. Set up the database
```ssh
npm run migrate
```
5. Start the server
```ssh
npm start
```
6. (Optional) Use Cloudflare Zero Trust - Access to setup login

# How to update
1. Clone new source
2. Install dependencies
```ssh
npm install
```
3. Set up the database
```ssh
npm run migrate
```
4. Start the server
```ssh
npm start
```

## License
This project is licensed under the GNU General Public License v3.0 (GPL-3.0) - see the LICENSE file for details.

## Author
Toby Nguyen

## Acknowledgments
- [SimpleFIN](https://beta-bridge.simplefin.org/) for their straightforward financial API
- [Maybe Finance](https://github.com/maybe-finance/maybe) for their personal finance platform
