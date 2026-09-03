package com.creepyim.mcp.resolver.util

import org.tomlj.Toml
import org.tomlj.TomlTable

object Toml {
    fun parse(text: String): TomlTable? = runCatching { Toml.parse(text) }.getOrNull()

    fun stringTable(table: TomlTable?, key: String): Map<String, String> =
        if (table?.contains(key) == true && table.get(key) is TomlTable) {
            val sub = table.get(key) as TomlTable
            sub.keySet().associateWith { name -> sub.getString(name) ?: "" }
        } else {
            emptyMap()
        }

    fun strings(table: TomlTable?, key: String): List<String> =
        if (table?.contains(key) == true && table.get(key) is List<*>) {
            (table.get(key) as List<*>).mapNotNull { it as? String }
        } else {
            emptyList()
        }
}