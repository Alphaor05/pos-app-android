import { NativeModules } from 'react-native';

export interface PrinterService {
    printReceipt(device: { address: string; name: string }, data: any): Promise<boolean>;
    getPairedDevices(): Promise<any[]>;
    enableBluetooth(): Promise<boolean>;
    openBluetoothSettings(): Promise<boolean>;
}

export const printerService = {
    async printReceipt(device: { address: string; name: string }, data: any): Promise<boolean> {
        try {
            // Note: device address and name are currently ignored in the NativeModule 
            // as it targets 'BT-583' directly as requested.
            
            const payload = {
                sale_id: data.orderId,
                total: data.total,
                employee_name: data.employeeName || 'Staff',
                payment_method: data.paymentMethod || 'Cash',
                created_at: data.createdAt,
                items: data.items.map((i: any) => ({
                    name: i.name,
                    quantity: i.quantity,
                    price: i.price
                }))
            };

            return await NativeModules.PrinterModule.printReceipt(payload);
        } catch (error) {
            console.warn('Native PrinterModule bridge failed', error);
            return false;
        }
    },
    
    async getPairedDevices(): Promise<any[]> {
        try {
            return await NativeModules.PrinterModule.getPairedDevices();
        } catch (error) {
            console.error('Failed to get paired devices', error);
            return [];
        }
    },

    async enableBluetooth(): Promise<boolean> {
        try {
            return await NativeModules.PrinterModule.enableBluetooth();
        } catch (error) {
            console.error('Failed to enable bluetooth', error);
            return false;
        }
    },

    async openBluetoothSettings(): Promise<boolean> {
        try {
            return await NativeModules.PrinterModule.openBluetoothSettings();
        } catch (error) {
            console.error('Failed to open bluetooth settings', error);
            return false;
        }
    }
};
