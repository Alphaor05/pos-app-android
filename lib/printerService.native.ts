import { NativeModules } from 'react-native';
import { buildReceipt, ReceiptPayload } from '@/lib/receiptBuilder';

export interface PrinterDevice {
    address: string;
    name: string;
    printMode?: 'Bluetooth' | 'USB' | 'Network' | 'Wi-Fi';
}

export const printerService = {
    async printReceipt(device: PrinterDevice, data: ReceiptPayload): Promise<boolean> {
        try {
            console.log('[PrinterService] Building receipt from offline design...', {
                device: device.name,
                orderId: data.orderId,
                items: data.items.length,
                total: data.total,
            });

            // Build the formatted ESC/POS string from the offline DB design
            const { formattedText, widthMM, charsPerLine, openCashDrawer, drawerCmds, printMode } = await buildReceipt(data);

            console.log(`[PrinterService] Sending to printer (${widthMM}mm, ${charsPerLine} chars, mode: ${printMode})...`);
            const result = await NativeModules.PrinterModule.printRawText(
                formattedText,
                device.address,
                widthMM,
                charsPerLine,
                openCashDrawer || false,
                drawerCmds || '1B,70,00,3C,FF',
                device.printMode || printMode || 'Bluetooth'
            );

            const success = typeof result === 'boolean' ? result : result?.success || false;
            const code = typeof result === 'object' ? result?.code : (success ? 'SUCCESS' : 'PRINT_ERROR');
            const message = typeof result === 'object' ? result?.message : '';

            if (success) {
                console.log('[PrinterService] ✓ Print successful');
                return true;
            } else {
                console.warn('[PrinterService] ✗ Print failed:', { code, message, device: device.address });
                return false;
            }
        } catch (error) {
            console.error('[PrinterService] Native bridge error:', { error: String(error), device: device.address });
            return false;
        }
    },

    async getPairedDevices(): Promise<{ name: string; address: string; id: string }[]> {
        try {
            return await NativeModules.PrinterModule.getPairedDevices();
        } catch (error) {
            console.error('[PrinterService] getPairedDevices error:', error);
            return [];
        }
    },

    async getUsbDevices(): Promise<{ name: string; address: string; id: string }[]> {
        try {
            if (NativeModules.PrinterModule.getUsbDevices) {
                return await NativeModules.PrinterModule.getUsbDevices();
            }
            return [];
        } catch (error) {
            console.error('[PrinterService] getUsbDevices error:', error);
            return [];
        }
    },

    async requestUsbPermission(deviceName: string): Promise<boolean> {
        try {
            if (NativeModules.PrinterModule.requestUsbPermission) {
                return await NativeModules.PrinterModule.requestUsbPermission(deviceName);
            }
            return false;
        } catch (error) {
            console.error('[printerService] requestUsbPermission error:', error);
            return false;
        }
    },

    async enableBluetooth(): Promise<boolean> {
        try {
            return await NativeModules.PrinterModule.enableBluetooth();
        } catch (error) {
            console.error('[PrinterService] enableBluetooth error:', error);
            return false;
        }
    },

    async openSettings(): Promise<boolean> {
        try {
            return await NativeModules.PrinterModule.openSettings();
        } catch (error) {
            console.error('[PrinterService] openSettings error:', error);
            return false;
        }
    },
    async openCashDrawer(address: string, mode: string = 'Bluetooth'): Promise<{ success: boolean; message: string }> {
        try {
            return await NativeModules.PrinterModule.openCashDrawer(address, mode);
        } catch (error) {
            console.error('[PrinterService] openCashDrawer error:', error);
            return { success: false, message: String(error) };
        }
    }
};
