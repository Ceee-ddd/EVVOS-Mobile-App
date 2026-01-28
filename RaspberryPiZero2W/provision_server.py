#!/usr/bin/env python3
"""
EVVOS Raspberry Pi Provisioning Server (Flask)
Receives SSID/password from mobile app via POST /provision
Configures wpa_supplicant to connect to phone hotspot
Once connected, calls finish_provisioning edge function
"""

from flask import Flask, request, jsonify
import subprocess
import time
import requests
import os
import sys

app = Flask(__name__)

# Get environment variables
EDGE_FINISH_URL = os.environ.get('EDGE_FINISH_URL', 'https://your-supabase-project.functions.supabase.co/functions/v1/finish_provisioning')
SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

# Configuration
AP_NETWORK = "EVVOS_0001"
WLAN_INTERFACE = "wlan0"
AP_RESTORED_FILE = "/tmp/evvos_ap_restored"
PROVISIONED_FILE = "/etc/evvos_provisioned"


def run(cmd, check=True, timeout=None):
    """Run shell command and return result"""
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            check=check,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return result
    except subprocess.TimeoutExpired:
        print(f"Command timeout: {cmd}")
        return None
    except Exception as e:
        print(f"Command failed: {cmd}, error: {e}")
        return None


def is_connected_to_wifi(max_retries=20):
    """Check if wlan0 has an IP address"""
    for i in range(max_retries):
        result = run(f"/sbin/ifconfig {WLAN_INTERFACE} || ip addr show {WLAN_INTERFACE}", check=False)
        if result and result.stdout:
            if "inet " in result.stdout:
                print(f"✅ Connected to WiFi (attempt {i+1})")
                return True
        time.sleep(1)
    
    print(f"❌ Failed to connect to WiFi after {max_retries} attempts")
    return False


def restore_ap_mode():
    """Restore the AP mode"""
    print("🔄 Restoring AP mode (hostapd/dnsmasq)...")
    run('systemctl start hostapd', check=False)
    run('systemctl start dnsmasq', check=False)
    # Mark that AP was restored
    open(AP_RESTORED_FILE, 'w').close()


def create_wpa_config(ssid, password):
    """Create wpa_supplicant configuration"""
    config = f"""ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=PH

network={{
	ssid="{ssid}"
	psk="{password}"
	scan_ssid=1
}}
"""
    return config


@app.route('/provision', methods=['POST'])
def provision():
    """
    Receive provisioning request from mobile app
    POST body: { token, ssid, password, device_name }
    """
    try:
        data = request.get_json(force=True) or {}
        token = data.get('token')
        ssid = data.get('ssid')
        password = data.get('password')
        device_name = data.get('device_name', 'EVVOS_0001')

        if not (token and ssid and password):
            return jsonify({'ok': False, 'error': 'Missing fields (token, ssid, password)'}), 400

        print(f"\n🔵 Received provisioning request:")
        print(f"   SSID: {ssid}")
        print(f"   Device: {device_name}")
        print(f"   Token: {token[:8]}...")

        # Step 1: Create temporary wpa_supplicant config
        print("\n📝 Step 1: Creating wpa_supplicant config...")
        wpa_conf = create_wpa_config(ssid, password)
        tmp_path = "/tmp/wpa_supplicant_tmp.conf"
        with open(tmp_path, 'w') as fh:
            fh.write(wpa_conf)
        print(f"   ✅ Config created at {tmp_path}")

        try:
            # Step 2: Stop AP mode services
            print("\n🔴 Step 2: Stopping AP services...")
            run('systemctl stop hostapd', check=False)
            run('systemctl stop dnsmasq', check=False)
            time.sleep(1)
            print("   ✅ AP services stopped")

            # Step 3: Place wpa_supplicant config
            print("\n⚙️  Step 3: Configuring wpa_supplicant...")
            run(f'cp {tmp_path} /etc/wpa_supplicant/wpa_supplicant.conf')
            print("   ✅ Config placed")

            # Step 4: Reconfigure and connect
            print("\n🔗 Step 4: Attempting to connect to hotspot...")
            run('wpa_cli -i wlan0 reconfigure', check=False)
            time.sleep(2)

            # Step 5: Check connection
            print("\n📡 Step 5: Checking connection (up to 20 seconds)...")
            if not is_connected_to_wifi(max_retries=20):
                print("   ❌ Failed to connect to hotspot")
                restore_ap_mode()
                return jsonify({
                    'ok': False,
                    'error': 'Failed to connect to hotspot. Please check SSID/password and try again.'
                }), 400

            print("   ✅ Connected!")

            # Step 6: Call finish_provisioning edge function
            print("\n📤 Step 6: Calling finish_provisioning edge function...")
            payload = {
                'token': token,
                'ssid': ssid,
                'password': password,
                'device_name': device_name
            }
            
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {SERVICE_ROLE_KEY}'
            }

            try:
                resp = requests.post(EDGE_FINISH_URL, json=payload, headers=headers, timeout=15)
                print(f"   Response status: {resp.status_code}")
                
                if resp.status_code != 200:
                    print(f"   ❌ Edge function failed: {resp.text}")
                    restore_ap_mode()
                    return jsonify({
                        'ok': False,
                        'error': 'Device connection registered but edge function failed',
                        'detail': resp.text
                    }), 500
                
                print(f"   ✅ Edge function succeeded")
            except requests.RequestException as e:
                print(f"   ❌ Request error: {e}")
                restore_ap_mode()
                return jsonify({
                    'ok': False,
                    'error': 'Failed to call edge function',
                    'detail': str(e)
                }), 500

            # Step 7: Mark as provisioned
            print("\n✨ Step 7: Marking device as provisioned...")
            open(PROVISIONED_FILE, 'w').write('1')
            print("   ✅ Provisioned marker created")

            # Step 8: Stop AP mode permanently (optional - you can keep it for fallback)
            print("\n🛑 Step 8: Stopping AP (device is now provisioned)...")
            run('systemctl stop hostapd', check=False)
            run('systemctl stop dnsmasq', check=False)
            run('systemctl stop provision-server', check=False)
            print("   ✅ AP stopped")

            print("\n🎉 Provisioning complete!\n")
            return jsonify({'ok': True, 'message': 'Device provisioned successfully'}), 200

        except Exception as e:
            print(f"\n❌ Error during provisioning: {e}")
            # Try to restore AP
            restore_ap_mode()
            return jsonify({
                'ok': False,
                'error': 'Provisioning failed',
                'detail': str(e)
            }), 500

    except Exception as e:
        print(f"❌ Request handler error: {e}")
        return jsonify({
            'ok': False,
            'error': 'Invalid request',
            'detail': str(e)
        }), 400


@app.route('/provision-status', methods=['GET'])
def provision_status():
    """Check if device is provisioned"""
    if os.path.exists(PROVISIONED_FILE):
        return jsonify({'ok': True, 'provisioned': True}), 200
    return jsonify({'ok': True, 'provisioned': False}), 200


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'ok': True, 'status': 'provisioning server running'}), 200


if __name__ == '__main__':
    print("🚀 EVVOS Provisioning Server starting on 0.0.0.0:80")
    print(f"   Edge function URL: {EDGE_FINISH_URL}")
    app.run(host='0.0.0.0', port=80, debug=False)
