cmake_minimum_required(VERSION 3.16)
project(cold_start_category_predictor LANGUAGES CXX)

add_executable(cold_start_category_predictor cold_start_category_predictor.cpp)
target_compile_features(cold_start_category_predictor PRIVATE cxx_std_17)

if (MSVC)
  target_compile_options(cold_start_category_predictor PRIVATE /O2 /W4)
else()
  target_compile_options(cold_start_category_predictor PRIVATE -O3 -Wall -Wextra -pedantic)
endif()
