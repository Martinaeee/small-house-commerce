# TECH_STACK.md

# Philippines Small House Ecommerce Platform Technology Stack

Version: V1.0


Project:

Philippines Small House COD Ecommerce Website



---

# 1. Purpose


This document defines the technical architecture and technology choices for the project.


The purpose:


- Standardize development environment
- Guide Codex AI development
- Ensure scalability
- Reduce unnecessary complexity


This document applies to:


- Frontend development
- Backend development
- Database implementation
- Deployment



---

# 2. Technology Selection Principles


The project follows these principles:



## 2.1 MVP First


The technology stack must support:

- Fast development
- Easy maintenance
- Future expansion



---

## 2.2 Developer Friendly


The system should be understandable and maintainable by:


- Individual developer
- AI coding agent
- Future developers



---

## 2.3 Scalable Architecture


The MVP should allow future expansion:


From:


Simple ecommerce website


To:


COD operation platform



---

# 3. Overall Architecture


The system architecture:



Customer Browser

    ↓

Frontend Application

    ↓

API Layer

    ↓

Backend Service

    ↓

Database



Additional services:



Image Storage

Authentication

Analytics

Logistics Integration




---

# 4. Frontend Technology


## Framework


Use:



Next.js




Version:

Latest stable version.



Reason:


- SEO friendly
- Server Side Rendering support
- Good performance
- Suitable for ecommerce
- Excellent AI development support



---

## Language


Use:



TypeScript




Reason:


- Better type safety
- Easier maintenance
- Reduce frontend bugs



---

## Styling


Use:



Tailwind CSS




Reason:


- Fast UI development
- Consistent design system
- Easy responsive design



---

## Frontend Requirements


Frontend must support:


- Mobile first design
- Responsive layout
- SEO optimization
- Image optimization
- Fast loading



---

# 5. Frontend Structure


Recommended:



frontend/

app/

components/

features/

hooks/

services/

styles/

types/




Architecture principle:


Pages

↓

Components

↓

API Services

↓

Backend API



---

# 6. Backend Technology


## Framework


Use:



NestJS




Reason:


- Structured architecture
- Suitable for business systems
- Good TypeScript support
- Easy module separation



---

## Language


Use:



TypeScript




---

# 7. Backend Architecture


Backend follows:


Modular Architecture



Example:



backend/

modules/

auth/

users/

customers/

products/

orders/

inventory/

shipment/

common/

database/




Each module contains:



Controller

Service

Repository

DTO

Entity




---

# 8. Database Technology


## Database


Use:



PostgreSQL




Reason:


The project contains:


- Orders
- Customers
- Inventory
- Relationships
- Transaction logic


A relational database is more suitable.



---

## ORM


Use:



Prisma ORM




Reason:


- Type safe
- Easy migration
- Good TypeScript integration
- AI friendly



---

# 9. Database Development Rules


Database changes must follow:



DATABASE.md

↓

DATABASE_MVP.md

↓

Prisma Schema

↓

Migration




Do not directly modify production database.



---

# 10. File Storage


## Product Images


Do NOT store images directly in database.



Use:



Cloudflare R2




or:



AWS S3




Database stores:



image_url




---

# 11. Authentication


Use:



JWT Authentication

Refresh Token




Authentication supports:


- Admin login
- Role permission
- Session renewal



---

# 12. Permission System


Roles:



ADMIN

CUSTOMER_SERVICE

CONFIRMOR

WAREHOUSE

OPTIMIZER




Permission must be handled by backend.



Frontend only displays available functions.



---

# 13. API Technology


Style:



REST API




Version:



/api/v1/




API rules:


Follow:



API_SPEC.md




---

# 14. Environment Management


Use:



.env




Environment variables:


Example:



DATABASE_URL=

JWT_SECRET=

STORAGE_KEY=

API_URL=




Sensitive information must NOT be committed.



---

# 15. Deployment Architecture


## Frontend


Recommended:



Vercel




Reason:


- Next.js optimized
- Easy deployment
- Good CDN



---

## Backend


Recommended:



Railway

Render

AWS




---

## Database


Recommended:



Supabase PostgreSQL

Railway PostgreSQL

AWS RDS




---

# 16. Development Tools


Required:


## Version Control



Git

GitHub




---

## Code Quality


Recommended:



ESLint

Prettier

TypeScript Check




---

## Testing


MVP requires:


- API testing
- Checkout flow testing
- Permission testing



---

# 17. Development Environment


Required:



Node.js

npm / pnpm

Git

VS Code

Database Client




---

# 18. Development Workflow


Standard workflow:



Requirement Document

↓

Database Design

↓

Backend API

↓

Frontend Integration

↓

Testing

↓

Deployment




---

# 19. AI Development Rules


When using Codex:


Before coding:


Agent MUST read:



README.md

MVP_SCOPE.md

BUSINESS_RULES.md

DATABASE.md

API_SPEC.md

TECH_STACK.md




Agent MUST NOT:


- Change technology stack without approval
- Add unnecessary dependencies
- Create duplicate systems
- Implement future features before MVP



---

# 20. MVP Technology Scope


The following are required:


## Frontend



Next.js

TypeScript

Tailwind CSS



## Backend



NestJS

TypeScript



## Database



PostgreSQL

Prisma



## Storage



Cloudflare R2



## Deployment



Vercel

Railway/Supabase




---

# 21. Future Expansion Compatibility


The architecture should allow future:


- COD risk system
- Attribution system
- Profit analytics
- CRM
- Automation
- Multi warehouse
- AI recommendation



---

# 22. Technology Decision Summary


Final MVP stack:


| Layer | Technology |
|---|---|
| Frontend | Next.js |
| Language | TypeScript |
| UI | Tailwind CSS |
| Backend | NestJS |
| Database | PostgreSQL |
| ORM | Prisma |
| Storage | Cloudflare R2 |
| Authentication | JWT + Refresh Token |
| Deployment Frontend | Vercel |
| Deployment Backend | Railway/Render |
| Version Control | GitHub |



---

END