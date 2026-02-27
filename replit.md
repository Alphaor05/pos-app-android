# POS Terminal App

A professional Android tablet POS (Point of Sale) application built with Expo React Native.

## Architecture

- **Frontend**: Expo Router (file-based routing), React Native
- **Backend**: Express.js (serves landing page + API)
- **State**: React Context (Auth, Cart, Bluetooth)
- **Storage**: AsyncStorage for PIN and Bluetooth printer persistence
- **Fonts**: @expo-google-fonts/inter

## Screens

- `app/index.tsx` - PIN Login screen (4-digit numpad)
- `app/pos.tsx` - Main POS sales screen (tablet landscape layout)
- `app/settings.tsx` - Settings: Bluetooth printer + PIN change

## Key Features

- 4-digit PIN login with shake animation on wrong entry
- Tablet landscape layout: sidebar + product grid + cart panel
- Product search and category filtering
- 3-column product grid with images and prices
- Cart with quantity controls and tax calculation
- Bluetooth fiscal printer pairing (simulated for Expo Go)
- PIN change in settings
- Dark professional POS theme (navy/slate)

## Context Providers

- `context/AuthContext.tsx` - Authentication state, PIN management
- `context/CartContext.tsx` - Shopping cart state
- `context/BluetoothContext.tsx` - Bluetooth printer management (mock)

## Data

- `data/products.ts` - 15 sample products across 5 categories

## Theme

Dark navy POS theme:
- Background: #0D1117
- Surface: #161B22
- Accent: #2563EB (blue)
- Success: #16A34A
- Danger: #DC2626

## Default PIN

`1234` (can be changed in Settings)
