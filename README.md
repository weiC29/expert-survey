# Expert Surgical Outcome Survey

An interactive web application for collecting expert predictions on surgical outcomes.  
Built with **Flask (backend)** + **React (frontend)** and integrated with **Google Sheets** for data storage.

---

## Features
- Secure user login with name + email
- Patient selection (dropdown) and claim locking  
- Entry form for:
  - Surgical outcome (success / failure)
  - Confidence level
  - Estimated postoperative SNOT-22 score (0–110 slider)
- Resume where you left off (session-based)
- Edit previous predictions (user-only)
- Real-time updates to Google Sheets
- Admin CSV export

---

## Tech Stack
- **Backend**: Flask, Flask-Session, gspread (Google Sheets API)
- **Frontend**: React + Vite + Material UI
- **Database**: Google Sheets (via Service Account)
- **Deployment**:  
  - Backend → Render  
  - Frontend → Vercel

---

## Project Structure