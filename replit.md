# TREKKER-MD WhatsApp Bot Session Manager

## Project Overview
This is a WhatsApp bot session management system that allows users to generate QR codes and pairing codes for connecting WhatsApp bots. The application provides a web interface for managing WhatsApp bot sessions with secure credential storage.

## Current State
- **Status**: Fully operational and ready to use
- **Environment**: Configured for Replit with proper proxy support
- **Database**: MongoDB integration with secure credential storage
- **Frontend**: Responsive web interface with multiple connection methods

## Recent Changes (September 04, 2025)
- Successfully imported GitHub repository and configured for Replit environment
- Added CORS configuration for Replit proxy compatibility
- Modified Express server to bind to 0.0.0.0:5000 for proper hosting
- Set up workflow configuration for automatic server management
- Configured VM deployment settings for production use
- Verified all routes and functionality working correctly

## Project Architecture

### Backend Components
- **Express.js server** running on port 5000
- **WhatsApp integration** via @whiskeysockets/baileys library
- **MongoDB database** for session credential storage
- **QR code generation** for WhatsApp pairing
- **Session validation** and management

### Key Routes
- `/` - Main homepage with application overview
- `/qr` - QR code generation for WhatsApp pairing
- `/pair` - Pairing code interface
- `/validate` - Session validation tool
- `/api/sessions` - Session storage debugging endpoint

### Dependencies
- Node.js 20+ with Express.js framework
- MongoDB for credential storage
- Baileys library for WhatsApp integration
- Various utilities (qrcode, cors, body-parser, etc.)

### Environment Configuration
- **MONGODB_URI**: MongoDB connection string (configured via Replit Secrets)
- **PORT**: Server port (defaults to 5000)
- **CORS**: Enabled for Replit proxy support

## User Preferences
- Prefers functional, working applications over documentation
- Values security and proper environment setup
- Expects applications to work immediately after setup

## Deployment Notes
- Configured for VM deployment (always-on server)
- Uses production-ready Node.js configuration
- MongoDB credentials secured via environment variables
- All routes tested and verified working

## Technical Notes
- Server binds to 0.0.0.0:5000 for Replit compatibility
- CORS configured with origin: true for proxy support
- WhatsApp session data stored securely in MongoDB
- PM2 process management available but not required in Replit environment