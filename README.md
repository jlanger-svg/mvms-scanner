# Mills Campus Vehicle Tracker — Mobile

Password-protected mobile workflow for vehicle intake, custody transfers, GPS location, zone selection and up to two photographs.

VINs entered manually or captured by the camera are decoded through NHTSA vPIC. Year, make and model are filled automatically when available; all fields remain editable and exterior colour is entered manually.

Manual lookup accepts either the complete VIN or its last 6–8 characters. Multiple matches are presented for employee selection; a new vehicle still requires its complete VIN.

Before deployment, run the accompanying backend SQL and configure the matching Supabase project. Netlify build command: `npm run build`; publish directory: `dist`.
