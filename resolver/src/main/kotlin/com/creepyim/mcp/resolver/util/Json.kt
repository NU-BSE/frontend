package com.creepyim.mcp.resolver.util

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper

object Json {
    private val mapper = ObjectMapper()

    fun parse(text: String): JsonNode? = runCatching { mapper.readTree(text) }.getOrNull()

    fun parseStrict(text: String): JsonNode = mapper.readTree(text)

    fun text(node: JsonNode?, field: String): String? =
        node?.get(field)?.takeIf { it.isTextual }?.asText()

    fun array(node: JsonNode?, field: String): List<JsonNode>? =
        node?.get(field)?.takeIf { it.isArray }?.toList()

    fun textArray(node: JsonNode?, field: String): List<String>? =
        node?.get(field)?.takeIf { it.isArray }?.mapNotNull { item ->
            if (item.isTextual) item.asText() else null
        }

    fun obj(node: JsonNode?, field: String): JsonNode? =
        node?.get(field)?.takeIf { it.isObject }

    fun has(node: JsonNode?, field: String): Boolean =
        node?.has(field) == true && !node.get(field).isNull
}