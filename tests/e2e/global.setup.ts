import { test as setup } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authDir = path.join(__dirname, '../../playwright/.auth');

async function authenticate(
  email: string,
  password: string,
  role: 'admin' | 'staff',
  authFile: string,
  baseURL: string | undefined
) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase Configuration Missing in .env');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const {
    data: { session },
    error,
  } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !session) {
    throw new Error(`Authentication failed for ${role} (${email}): ${error?.message}`);
  }

  const authKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
  const storageStateJson = {
    cookies: [],
    origins: [
      {
        origin: baseURL as string,
        localStorage: [
          {
            name: authKey,
            value: JSON.stringify(session),
          },
          {
            name: 'view_as_user',
            value: 'false',
          },
          {
            name: `role_${session.user.id}`,
            value: role,
          },
        ],
      },
    ],
  };

  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  fs.writeFileSync(authFile, JSON.stringify(storageStateJson));
  console.log(`✅ Auth Setup: Logged in as ${email} (${role}) and saved state to ${authFile}`);
}

setup('authenticate admin', async ({ baseURL }) => {
  const email = process.env.TEST_ADMIN_EMAIL || process.env.VITE_TEST_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.TEST_ADMIN_PASSWORD || process.env.VITE_TEST_ADMIN_PASSWORD || 'password123';
  await authenticate(email, password, 'admin', path.join(authDir, 'admin.json'), baseURL);
});

setup('authenticate staff', async ({ baseURL }) => {
  const email = process.env.TEST_STAFF_EMAIL || process.env.VITE_TEST_STAFF_EMAIL || 'staff@example.com';
  const password = process.env.TEST_STAFF_PASSWORD || process.env.VITE_TEST_STAFF_PASSWORD || 'password123';
  await authenticate(email, password, 'staff', path.join(authDir, 'staff.json'), baseURL);
});
