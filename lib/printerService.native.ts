import { NativeModules } from 'react-native';
import { buildReceipt, ReceiptPayload } from '@/lib/receiptBuilder';

export interface PrinterDevice {
    address: string;
    name: string;
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
            const { formattedText, widthMM, charsPerLine } = await buildReceipt(data);

            console.log(`[PrinterService] Sending to printer (${widthMM}mm, ${charsPerLine} chars)...`);
            const result = await NativeModules.PrinterModule.printRawText(
                formattedText,
                device.address,
                widthMM,
                charsPerLine
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
    }
};
