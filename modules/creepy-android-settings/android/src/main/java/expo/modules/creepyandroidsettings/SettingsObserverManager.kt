package expo.modules.creepyandroidsettings

import android.content.ContentResolver
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import java.util.UUID

/**
 * Tracks `ContentObserver` registrations so that every subscription can be
 * released explicitly via `unwatchSetting`/`unwatchAllSettings` — and is
 * always torn down when the native module is destroyed, avoiding observer
 * leaks across React Native context recreation.
 */
class SettingsObserverManager(
    private val resolver: ContentResolver,
    private val onSettingChanged: (
        subscriptionId: String,
        namespace: SettingsNamespace,
        key: String,
        value: Any?,
        timestamp: Long,
    ) -> Unit,
) {
    private data class Subscription(
        val namespace: SettingsNamespace,
        val key: String,
        val observer: ContentObserver,
    )

    private val subscriptions = mutableMapOf<String, Subscription>()

    fun watch(namespace: SettingsNamespace, key: String): String {
        val uri = getUriFor(namespace, key)
        val id = UUID.randomUUID().toString()

        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                onSettingChanged(id, namespace, key, readValue(namespace, key), System.currentTimeMillis())
            }
        }

        resolver.registerContentObserver(uri, false, observer)
        subscriptions[id] = Subscription(namespace, key, observer)
        return id
    }

    fun unwatch(subscriptionId: String) {
        val subscription = subscriptions.remove(subscriptionId)
            ?: throw ObserverNotFoundException(subscriptionId)
        unregister(subscription.observer)
    }

    fun unwatchAll() {
        subscriptions.values.forEach { unregister(it.observer) }
        subscriptions.clear()
    }

    private fun unregister(observer: ContentObserver) {
        try {
            resolver.unregisterContentObserver(observer)
        } catch (e: Exception) {
            // The provider is already gone; nothing to release.
        }
    }

    private fun getUriFor(namespace: SettingsNamespace, key: String): Uri = when (namespace) {
        SettingsNamespace.SYSTEM -> Settings.System.getUriFor(key)
        SettingsNamespace.SECURE -> Settings.Secure.getUriFor(key)
        SettingsNamespace.GLOBAL -> Settings.Global.getUriFor(key)
    }

    private fun readValue(namespace: SettingsNamespace, key: String): Any? {
        val raw = try {
            when (namespace) {
                SettingsNamespace.SYSTEM -> Settings.System.getString(resolver, key)
                SettingsNamespace.SECURE -> Settings.Secure.getString(resolver, key)
                SettingsNamespace.GLOBAL -> Settings.Global.getString(resolver, key)
            }
        } catch (e: Exception) {
            return null
        } ?: return null

        raw.toLongOrNull()?.let { return it }
        raw.toDoubleOrNull()?.let { return it }
        return raw
    }
}
